import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { QueueDeliveryAdmission } from "../src/daemon/queue-delivery";
import { observeValidatedAgentEvent } from "../src/main/activity-queue/agent-source";
import {
	workspaceReply,
	workspaceReplyCapability,
} from "../src/main/activity-queue/conversation-replies";
import { listWorkspaceQueue } from "../src/main/activity-queue/workspace-queue";
import { getDb } from "../src/main/db";
import {
	activityQueueDeliveries,
	activityQueueSources,
	agentSessions,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
let workspaceId: string;
let item: WorkspaceQueueItem;
let writes: number;
let beforeAdmission: () => void;
let daemon: ReturnType<typeof fakeDaemon>;
function fakeDaemon() {
	return {
		isConnected: true,
		supportsQueueReply: true,
		async listSessionsStrict() {
			return [
				{ id: "owner", pid: 1, cwd: "/tmp" },
				{ id: "sibling", pid: 2, cwd: "/tmp" },
			];
		},
		async queueReplyTarget() {
			return { generation: "g", supported: true, foreground: "codex" };
		},
		async submitQueueReply(id: string, _generation: string, requestId: string, content: string) {
			beforeAdmission();
			return new QueueDeliveryAdmission(getDb().$client).admit(requestId, id, content, () => {
				writes++;
				return "admitted";
			});
		},
	};
}
function stop(terminalId = "owner", turnId = "turn-one") {
	observeValidatedAgentEvent({
		terminalId,
		sessionId: terminalId,
		workspaceId,
		providerSessionId: `${terminalId}-chat`,
		agent: "codex",
		alert: "task-complete",
		rawEvent: "Stop",
		timestamp: Date.now(),
		turnId,
		cwd: "/tmp",
	});
}
beforeAll(setupTestDb);
beforeEach(async () => {
	const db = getDb();
	db.delete(activityQueueDeliveries).run();
	db.delete(activityQueueSources).run();
	db.delete(agentSessions).run();
	db.delete(terminalSessions).run();
	db.delete(workspaces).run();
	db.delete(projects).run();
	workspaceId = await seedWorkspace(await seedProject(), { name: "synthetic" });
	for (const terminalId of ["owner", "sibling"]) {
		db.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId,
				title: terminalId,
				cwd: "/tmp",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
		db.insert(agentSessions)
			.values({
				terminalId,
				workspaceId,
				entityKind: "workspace",
				provider: "codex",
				providerSessionId: `${terminalId}-chat`,
				managed: false,
				state: "idle",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();
		stop(terminalId);
	}
	writes = 0;
	beforeAdmission = () => {};
	daemon = fakeDaemon();
	setDaemonClient(daemon as unknown as DaemonClient);
	item = (await listWorkspaceQueue()).items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === "owner"
	)!;
	expect(item).toBeDefined();
});
afterEach(() => setDaemonClient(null));
const input = (requestId = "one") => ({
	id: item.id,
	revision: item.revision,
	members: item.members,
	requestId,
	content: "Reply with QUEUE_TEST_OK only.",
});
test("actual persisted daemon admission admits once; repeated/concurrent/reconnected requests cannot duplicate", async () => {
	expect((await workspaceReplyCapability(item)).status).toBe("available");
	const results = await Promise.all([workspaceReply(input()), workspaceReply(input())]);
	expect(results.some((r) => r.status === "admitted")).toBe(true);
	expect(writes).toBe(1);
	expect((await workspaceReply(input())).status).toBe("admitted");
	expect((await workspaceReply(input("different"))).status).toBe("conflict");
	expect((await workspaceReply({ ...input(), content: "changed" })).status).toBe("conflict");
	expect(writes).toBe(1);
	// PTY admission never acknowledges sources or claims model consumption.
	expect((await listWorkspaceQueue()).items).toHaveLength(2);
});
test("busy, hibernated, legacy daemon, stale source and provider replacement never submit", async () => {
	for (const state of ["running", "needs-input", "hibernated", "resuming"] as const) {
		getDb().update(agentSessions).set({ state }).where(eq(agentSessions.terminalId, "owner")).run();
		expect((await workspaceReply(input())).status).toBe("unavailable");
	}
	getDb()
		.update(agentSessions)
		.set({ state: "idle" })
		.where(eq(agentSessions.terminalId, "owner"))
		.run();
	daemon.supportsQueueReply = false;
	expect((await workspaceReply(input())).status).toBe("unavailable");
	daemon.supportsQueueReply = true;
	expect((await workspaceReply({ ...input(), revision: item.revision + 1 })).status).toBe(
		"conflict"
	);
	getDb()
		.update(agentSessions)
		.set({ providerSessionId: "replacement" })
		.where(eq(agentSessions.terminalId, "owner"))
		.run();
	expect((await workspaceReply(input())).status).toBe("conflict");
	expect(writes).toBe(0);
});
test("busy transition at atomic daemon boundary rejects without delivery", async () => {
	beforeAdmission = () =>
		getDb()
			.update(agentSessions)
			.set({ state: "running" })
			.where(eq(agentSessions.terminalId, "owner"))
			.run();
	expect((await workspaceReply(input())).status).toBe("rejected");
	expect(writes).toBe(0);
});
test("a later occurrence during admission survives, and its old receipt is rejected", async () => {
	beforeAdmission = () =>
		getDb()
			.update(activityQueueSources)
			.set({ revision: item.revision + 1 })
			.where(eq(activityQueueSources.sourceId, item.id))
			.run();
	expect((await workspaceReply(input())).status).toBe("rejected");
	expect(writes).toBe(0);
	expect((await listWorkspaceQueue()).items.find((i) => i.id === item.id)?.revision).toBe(
		item.revision + 1
	);
});
test("lost daemon response uses committed receipt and never resubmits", async () => {
	const submit = daemon.submitQueueReply.bind(daemon);
	daemon.submitQueueReply = async (...args) => {
		await submit(...args);
		throw new Error("disconnect after write");
	};
	expect((await workspaceReply(input())).status).toBe("admitted");
	expect((await workspaceReply(input())).status).toBe("admitted");
	expect(writes).toBe(1);
});
test("crash before receipt remains uncertain and blocks retry with any request ID", async () => {
	daemon.submitQueueReply = async () => {
		writes++;
		throw new Error("unknown handoff");
	};
	expect((await workspaceReply(input())).status).toBe("uncertain");
	expect((await workspaceReply(input())).status).toBe("uncertain");
	expect((await workspaceReply(input("new"))).status).toBe("conflict");
	expect(writes).toBe(1);
});
test("a definitely rejected request remains immutable while an explicit fresh attempt may retry", async () => {
	beforeAdmission = () =>
		getDb()
			.update(agentSessions)
			.set({ state: "running" })
			.where(eq(agentSessions.terminalId, "owner"))
			.run();
	expect((await workspaceReply(input())).status).toBe("rejected");
	beforeAdmission = () => {};
	getDb()
		.update(agentSessions)
		.set({ state: "idle" })
		.where(eq(agentSessions.terminalId, "owner"))
		.run();
	expect((await workspaceReply(input())).status).toBe("rejected");
	expect((await workspaceReply(input("explicit-retry"))).status).toBe("admitted");
	expect(writes).toBe(1);
});
test("a newly appearing structured question at admission blocks ordinary free-form input", async () => {
	beforeAdmission = () => {
		const source = getDb()
			.select()
			.from(activityQueueSources)
			.where(eq(activityQueueSources.sourceId, item.id))
			.get()!;
		getDb()
			.insert(activityQueueSources)
			.values({
				...source,
				sourceId: "new-question",
				sourceType: "agent-question",
				candidate: {
					...source.candidate!,
					kind: "agent-input",
					reasons: [{ code: "question", label: "Question" }],
				},
			})
			.run();
	};
	expect((await workspaceReply(input())).status).toBe("rejected");
	expect(writes).toBe(0);
});

for (const provider of ["claude", "codex"] as const)
	for (const kind of ["worktree", "folder", "orchestrator", "coordinator"] as const) {
		test(`${provider} ${kind}: exact delivery preserves sibling, identity and later occurrence`, async () => {
			const { seedCrossRepoOrchestrator } = await import("./helpers/db");
			const db = getDb();
			const projectId = await seedProject();
			if (kind === "folder")
				db.update(projects).set({ kind: "folder" }).where(eq(projects.id, projectId)).run();
			const entityId =
				kind === "coordinator"
					? await seedCrossRepoOrchestrator({ agentKind: provider, projectIds: [projectId] })
					: await seedWorkspace(projectId, {
							name: `${kind} delivery`,
							isOrchestrator: kind === "orchestrator",
						});
			const entityKind = kind === "coordinator" ? "coordinator" : "workspace";
			const owner = `${provider}-${kind}-owner`;
			const sibling = `${provider}-${kind}-sibling`;
			for (const terminalId of [owner, sibling]) {
				db.insert(terminalSessions)
					.values({
						id: terminalId,
						workspaceId: entityId,
						title: terminalId,
						cwd: "/tmp",
						sortOrder: 0,
						updatedAt: new Date(),
					})
					.run();
				db.insert(agentSessions)
					.values({
						terminalId,
						workspaceId: entityId,
						entityKind,
						provider,
						providerSessionId: `${terminalId}-chat`,
						state: "idle",
						managed: kind !== "folder",
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.run();
				observeValidatedAgentEvent({
					terminalId,
					sessionId: terminalId,
					workspaceId: entityId,
					providerSessionId: `${terminalId}-chat`,
					agent: provider,
					alert: "task-complete",
					rawEvent: "Stop",
					timestamp: Date.now(),
					turnId: "initial",
					cwd: "/tmp",
				});
			}
			daemon.listSessionsStrict = async () =>
				db
					.select()
					.from(terminalSessions)
					.all()
					.map((t, index) => ({ id: t.id, cwd: t.cwd, pid: index + 1 }));
			const queue = (await listWorkspaceQueue()).items;
			const exact = queue.find(
				(i) => i.target.type === "terminal" && i.target.terminalId === owner
			)!;
			const siblingItem = queue.find(
				(i) => i.target.type === "terminal" && i.target.terminalId === sibling
			)!;
			expect(exact.context.entity).toEqual({ kind: entityKind, id: entityId });
			expect(exact.context.provider).toBe(provider);
			const calls: string[] = [];
			const submit = daemon.submitQueueReply.bind(daemon);
			daemon.submitQueueReply = async (...args) => {
				calls.push(args[0]);
				return submit(...args);
			};
			expect(
				(
					await workspaceReply({
						...exact,
						requestId: `matrix-${provider}-${kind}`,
						content: "Synthetic exact followup",
					})
				).status
			).toBe("admitted");
			expect(calls).toEqual([owner]);
			expect(
				(await listWorkspaceQueue()).items.find((i) => i.id === siblingItem.id)?.revision
			).toBe(siblingItem.revision);
			observeValidatedAgentEvent({
				terminalId: owner,
				sessionId: owner,
				workspaceId: entityId,
				providerSessionId: `${owner}-chat`,
				agent: provider,
				alert: "active",
				rawEvent: "UserPromptSubmit",
				timestamp: Date.now(),
				turnId: "fresh",
				cwd: "/tmp",
			});
			observeValidatedAgentEvent({
				terminalId: owner,
				sessionId: owner,
				workspaceId: entityId,
				providerSessionId: `${owner}-chat`,
				agent: provider,
				alert: "task-complete",
				rawEvent: "Stop",
				timestamp: Date.now(),
				turnId: "fresh",
				cwd: "/tmp",
			});
			const later = (await listWorkspaceQueue()).items;
			expect(later.find((i) => i.id === exact.id)?.revision).toBeGreaterThan(exact.revision);
			expect(later.find((i) => i.id === siblingItem.id)?.revision).toBe(siblingItem.revision);
			expect(later.find((i) => i.id === exact.id)?.target).toEqual(exact.target);
		});
	}
test("a newly grouped same-conversation receipt cannot be omitted at daemon admission", async () => {
	beforeAdmission = () => {
		const source = getDb()
			.select()
			.from(activityQueueSources)
			.where(eq(activityQueueSources.sourceId, item.id))
			.get()!;
		getDb()
			.delete(activityQueueSources)
			.where(eq(activityQueueSources.sourceId, `agent-workspace:${workspaceId}`))
			.run();
		getDb()
			.insert(activityQueueSources)
			.values({
				...source,
				sourceId: `agent-workspace:${workspaceId}`,
				sourceType: "agent-workspace",
				candidate: {
					...source.candidate!,
					kind: "agent-ready",
					reasons: [{ code: "workspace-done", label: "Task done" }],
				},
			})
			.run();
	};
	expect((await workspaceReply(input())).status).toBe("rejected");
	expect(writes).toBe(0);
});
for (const delivery of ["admitted", "uncertain"] as const)
	test(`${delivery}: report after handoff survives delayed provider prompt without upgrading delivery`, async () => {
		const { setStatus } = await import("../src/main/services/workspace-service");
		const { AgentSessionManager } = await import("../src/main/services/agent-session-manager");
		if (delivery === "uncertain")
			daemon.submitQueueReply = async () => {
				throw Error("lost response");
			};
		expect((await workspaceReply(input())).status).toBe(delivery);
		await new Promise((resolve) => setTimeout(resolve, 5));
		const projectId = getDb()
			.select()
			.from(workspaces)
			.where(eq(workspaces.id, workspaceId))
			.get()!.projectId;
		await setStatus(
			{ kind: "workspace", workspaceId, projectId, terminalId: "owner" },
			{ phase: "blocked", needs: "A genuinely later report" }
		);
		const manager = new AgentSessionManager({
			daemonClient: daemon as unknown as DaemonClient,
			processController: {
				inspectForeground: async () => ({ status: "agent" }),
				terminateForeground: async () => ({ ok: false }),
			},
			getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		});
		try {
			const event = {
				terminalId: "owner",
				sessionId: "owner",
				workspaceId,
				providerSessionId: "owner-chat",
				agent: "codex",
				alert: "active" as const,
				rawEvent: "UserPromptSubmit",
				timestamp: Date.now(),
				turnId: "delayed-submission",
				promptHash:
					delivery === "admitted"
						? (await import("../src/daemon/queue-delivery")).replyContentHash(input().content)
						: undefined,
				cwd: "/tmp",
			};
			expect(manager.handleAgentEvent(event)).not.toBeNull();
			expect(
				getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.needs
			).toBe("A genuinely later report");
			const stored = getDb()
				.select()
				.from(activityQueueDeliveries)
				.where(eq(activityQueueDeliveries.requestId, "one"))
				.get();
			expect(stored?.state).toBe(delivery);
			expect(stored?.continuationTurnId).toBe(
				delivery === "admitted" ? "delayed-submission" : null
			);
			if (delivery === "uncertain") {
				manager.handleAgentEvent({
					...event,
					rawEvent: "Stop",
					alert: "task-complete",
					timestamp: Date.now(),
				});
				await setStatus(
					{ kind: "workspace", workspaceId, projectId, terminalId: "owner" },
					{ phase: "blocked", needs: "Later explicit manual followup" }
				);
				await new Promise((resolve) => setTimeout(resolve, 5));
				manager.handleAgentEvent({ ...event, turnId: "manual-second", timestamp: Date.now() });
				expect(
					getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.needs
				).toBeNull();
				const after = getDb()
					.select()
					.from(activityQueueDeliveries)
					.where(eq(activityQueueDeliveries.requestId, "one"))
					.get();
				expect(after?.state).toBe("uncertain");
				expect(after?.continuationTurnId).toBeNull();
				expect(after?.cleanupProtectedTurnId).toBe("delayed-submission");
			}

			expect(
				(await listWorkspaceQueue()).items.some(
					(i) => i.target.type === "terminal" && i.target.terminalId === "sibling"
				)
			).toBe(true);
		} finally {
			manager.dispose();
		}
	});
test("only the exact prompt digest and conversation can establish provider receipt", async () => {
	const { queueReplyContinuationTime } = await import(
		"../src/main/activity-queue/reply-continuation"
	);
	const { replyContentHash } = await import("../src/daemon/queue-delivery");
	expect((await workspaceReply(input())).status).toBe("admitted");
	if (item.target.type !== "terminal") throw Error("expected terminal");
	queueReplyContinuationTime(
		{ ...item.target, terminalId: "sibling" },
		"wrong-owner",
		Date.now(),
		replyContentHash(input().content)
	);
	expect((await workspaceReply(input())).status).toBe("admitted");
	queueReplyContinuationTime(
		item.target,
		"unrelated",
		Date.now(),
		replyContentHash("another prompt")
	);
	expect((await workspaceReply(input())).status).toBe("admitted");
	queueReplyContinuationTime(
		item.target,
		"correlated",
		Date.now(),
		replyContentHash(input().content)
	);
	expect((await workspaceReply(input())).status).toBe("received");
	expect(writes).toBe(1);
});
test("read-only receipt recovery never creates or retries an absent intent", async () => {
	const { workspaceReplyReceipt } = await import("../src/main/activity-queue/conversation-replies");
	expect(workspaceReplyReceipt("absent")).toBeNull();
	expect(writes).toBe(0);
	expect((await workspaceReply(input())).status).toBe("admitted");
	expect(workspaceReplyReceipt("one")?.status).toBe("admitted");
	expect(writes).toBe(1);
});
test("a different explicit prompt digest never inherits an uncertain queued cleanup ceiling", async () => {
	const { queueReplyContinuationTime } = await import(
		"../src/main/activity-queue/reply-continuation"
	);
	daemon.submitQueueReply = async () => {
		throw Error("lost response");
	};
	await workspaceReply(input());
	if (item.target.type !== "terminal") throw Error("expected terminal");
	const time = Date.now() + 50;
	expect(queueReplyContinuationTime(item.target, "different-manual", time, "f".repeat(64))).toBe(
		time
	);
	const row = getDb()
		.select()
		.from(activityQueueDeliveries)
		.where(eq(activityQueueDeliveries.requestId, "one"))
		.get();
	expect(row?.state).toBe("uncertain");
	expect(row?.continuationTurnId).toBeNull();
	expect(row?.cleanupProtectedTurnId).toBeNull();
});
