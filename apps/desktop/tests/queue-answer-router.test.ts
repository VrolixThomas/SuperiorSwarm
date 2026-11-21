import "./preload-electron-mock";
import { cleanupAnswerFixtures, ownAnswerFixture } from "./helpers/queue-answer-cleanup";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { QueueDeliveryAdmission } from "../src/daemon/queue-delivery";
import { questionSourceId, workspaceReporter } from "../src/main/activity-queue/agent-source";
import { getDb } from "../src/main/db";
import {
	activityQueueDeliveries,
	agentMessages,
	agentSessions,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import { activityQueueRouter } from "../src/main/trpc/routers/activity-queue";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
afterEach(() => {
	setDaemonClient(null);
	cleanupAnswerFixtures();
});
const caller = activityQueueRouter.createCaller({});
async function fixture(provider: "claude" | "codex", scope: string, sleeping = false) {
	const db = getDb();
	const projectId = await seedProject();
	if (scope === "folder")
		db.update(projects).set({ kind: "folder" }).where(eq(projects.id, projectId)).run();
	const workspaceId =
		scope === "coordinator"
			? await seedCrossRepoOrchestrator({ projectIds: [projectId] })
			: await seedWorkspace(projectId, {
					name: "Answer routing",
					isOrchestrator: scope === "orchestrator",
				});
	ownAnswerFixture(projectId, workspaceId);
	if (scope === "folder")
		db.update(workspaces)
			.set({ type: "folder", folderPath: "/tmp" })
			.where(eq(workspaces.id, workspaceId))
			.run();
	const ids = [`${workspaceId}-owner`, `${workspaceId}-sibling`];
	for (const terminalId of ids) {
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
				entityKind: scope === "coordinator" ? "coordinator" : "workspace",
				provider,
				providerSessionId: `chat-${terminalId}`,
				state: "idle",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();
	}
	const owner = workspaceReporter(workspaceId, ids[0]);
	const sibling = workspaceReporter(workspaceId, ids[1]);
	if (!owner || !sibling) throw Error("Missing exact fixture owner");
	let beforeAdmission: () => void = () => {};
	const writes: { terminalId: string; content: string; mode: string }[] = [];
	let loseResponse = false;
	const admit = (
		mode: "live" | "resume",
		terminalId: string,
		requestId: string,
		content: string
	) => {
		beforeAdmission();
		const result = new QueueDeliveryAdmission(db.$client).admit(
			requestId,
			terminalId,
			content,
			() => {
				writes.push({ terminalId, content, mode });
				return "admitted";
			},
			mode
		);
		if (loseResponse) throw Error("Response lost after daemon commit");
		return result;
	};
	const daemon = {
		isConnected: true,
		supportsQueueReply: true,
		supportsQueueAnswer: true,
		supportsQueueResume: true,
		listSessionsStrict: async () => ids.map((id) => ({ id, cwd: "/tmp", pid: 1 })),
		queueReplyTarget: async () => ({
			supported: true,
			generation: "controlled-live",
			foreground: provider,
		}),
		queueResumeTarget: async () => ({
			supported: true,
			generation: "controlled-resume",
			foreground: "zsh",
		}),
		submitQueueReply: async (id: string, _generation: string, requestId: string, content: string) =>
			admit("live", id, requestId, content),
		submitQueueResume: async (
			id: string,
			_generation: string,
			requestId: string,
			content: string
		) => admit("resume", id, requestId, content),
	};
	setDaemonClient(daemon as unknown as DaemonClient);
	const manager = new AgentSessionManager({
		daemonClient: daemon as unknown as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	for (const target of [owner, sibling])
		manager.handleAgentEvent({
			agent: provider,
			terminalId: target.terminalId,
			sessionId: target.terminalId,
			workspaceId,
			providerSessionId: target.providerSessionId!,
			alert: "task-complete",
			rawEvent: "Stop",
			turnId: "initial-turn",
			timestamp: Date.now(),
			cwd: "/tmp",
		});
	if (sleeping)
		db.update(agentSessions)
			.set({ state: "hibernated" })
			.where(eq(agentSessions.terminalId, owner.terminalId))
			.run();
	const questionId = crypto.randomUUID();
	const siblingQuestionId = crypto.randomUUID();
	const ask = (id: string, target = owner) =>
		db
			.insert(agentMessages)
			.values({
				id,
				projectId,
				fromWorkspaceId: workspaceId,
				toWorkspaceId: null,
				reporter: target,
				kind: "question",
				content: "Pick a color",
				createdAt: new Date(),
			})
			.run();
	ask(questionId);
	ask(siblingQuestionId, sibling);
	const item = (await caller.workspaceList()).items.find(
		(i) => i.id === questionSourceId(questionId)
	);
	if (!item) throw Error("Question missing");
	const input = {
		id: item.id,
		revision: item.revision,
		members: item.members,
		questionId,
		content: "Use blue",
		requestId: crypto.randomUUID(),
	};
	return {
		input,
		daemon,
		owner,
		sibling,
		manager,
		writes,
		ask,
		siblingQuestionId,
		before: (fn: () => void) => {
			beforeAdmission = fn;
		},
		lose: () => {
			loseResponse = true;
		},
		accept: () => {
			const write = writes[0];
			if (!write) throw Error("No prompt submitted");
			return manager.handleAgentEvent({
				agent: provider,
				terminalId: owner.terminalId,
				sessionId: owner.terminalId,
				workspaceId,
				providerSessionId: owner.providerSessionId!,
				alert: "active",
				rawEvent: "UserPromptSubmit",
				turnId: "continued-turn",
				promptHash: createHash("sha256").update(write.content).digest("hex"),
				timestamp: Date.now() + 20,
				cwd: "/tmp",
			});
		},
	};
}
for (const provider of ["claude", "codex"] as const)
	for (const scope of ["worktree", "folder", "orchestrator", "coordinator"])
		for (const sleeping of [false, true])
			test(`${provider}/${scope}/${sleeping ? "sleeping" : "live"}: production router + SQL admission continues only saved answer`, async () => {
				const f = await fixture(provider, scope, sleeping);
				try {
					expect((await caller.workspaceAnswerContinuationCapability(f.input)).status).toBe(
						"available"
					);
					const result = await caller.workspaceAnswerAndContinue(f.input);
					expect(result.continuation.status).toBe("admitted");
					expect(result.answer?.delivery).toBe("saved");
					expect(f.writes).toHaveLength(1);
					expect(f.writes[0]?.mode).toBe(sleeping ? "resume" : "live");
					expect(f.writes[0]?.terminalId).toBe(f.owner.terminalId);
					const answerId = result.answer?.messageId;
					if (!answerId) throw Error("Missing saved answer");
					expect(
						getDb().select().from(agentMessages).where(eq(agentMessages.id, answerId)).get()
							?.retrievedAt
					).toBeNull();
					expect(f.accept()).not.toBeNull();
					const receipt = await caller.workspaceAnswerContinuationReceipt({ ...f.input, answerId });
					expect(receipt.continuation.status).toBe("received");
					expect(receipt.answer?.delivery).toBe("retrieved");
					const rows = (await caller.workspaceList()).items;
					expect(rows.some((i) => i.id === f.input.id)).toBe(false);
					expect(rows.some((i) => i.id === questionSourceId(f.siblingQuestionId))).toBe(true);
					expect(
						(await caller.workspaceAnswerAndContinue({ ...f.input, answerId })).continuation.status
					).toBe("received");
					expect(f.writes).toHaveLength(1);
				} finally {
					f.manager.dispose();
				}
			});
test("real ledger prevents concurrent different-request continuation duplicates", async () => {
	const f = await fixture("codex", "worktree");
	try {
		const results = await Promise.all([
			caller.workspaceAnswerAndContinue(f.input),
			caller.workspaceAnswerAndContinue({ ...f.input, requestId: crypto.randomUUID() }),
		]);
		expect(results.some((r) => r.continuation.status === "admitted")).toBe(true);
		expect(f.writes).toHaveLength(1);
		expect(
			getDb()
				.select()
				.from(agentMessages)
				.where(eq(agentMessages.inReplyTo, f.input.questionId))
				.all()
		).toHaveLength(1);
	} finally {
		f.manager.dispose();
	}
});
test("retrieval at daemon boundary sends nothing and returns already handled", async () => {
	const f = await fixture("claude", "folder");
	try {
		f.before(() => {
			const answer = getDb()
				.select()
				.from(agentMessages)
				.where(eq(agentMessages.inReplyTo, f.input.questionId))
				.get();
			if (!answer) throw Error("Missing saved answer");
			getDb()
				.update(agentMessages)
				.set({ retrievedAt: new Date() })
				.where(eq(agentMessages.id, answer.id))
				.run();
		});
		const result = await caller.workspaceAnswerAndContinue(f.input);
		expect(result.answer?.delivery).toBe("retrieved");
		expect(result.continuation.status).toBe("not-needed");
		expect(f.writes).toHaveLength(0);
	} finally {
		f.manager.dispose();
	}
});
test("lost transport response recovers actual persisted receipt without re-sending", async () => {
	const f = await fixture("codex", "coordinator", true);
	try {
		f.lose();
		const result = await caller.workspaceAnswerAndContinue(f.input);
		expect(result.continuation.status).toBe("admitted");
		await caller.workspaceAnswerAndContinue(f.input);
		expect(f.writes).toHaveLength(1);
	} finally {
		f.manager.dispose();
	}
});
test("long saved answer envelope beyond16000 characters keeps exact receipt and retrieval", async () => {
	const f = await fixture("codex", "worktree");
	try {
		const result = await caller.workspaceAnswerAndContinue({
			...f.input,
			content: "a".repeat(16000),
		});
		expect(result.continuation.status).toBe("admitted");
		expect(f.writes[0]?.content.length).toBeGreaterThan(16000);
		expect(f.accept()).not.toBeNull();
		const row = getDb()
			.select()
			.from(activityQueueDeliveries)
			.where(eq(activityQueueDeliveries.requestId, f.input.requestId))
			.get();
		expect(row?.continuationTurnId).toBe("continued-turn");
	} finally {
		f.manager.dispose();
	}
});
test("a new unprojected question at daemon boundary blocks continuing the old answer", async () => {
	const f = await fixture("codex", "worktree");
	try {
		f.before(() => {
			f.ask(crypto.randomUUID());
		});
		const result = await caller.workspaceAnswerAndContinue(f.input);
		expect(result.continuation.status).toBe("rejected");
		expect(f.writes).toHaveLength(0);
	} finally {
		f.manager.dispose();
	}
});

test("capability explains another pending question even after its answer was saved", async () => {
	const f = await fixture("codex", "worktree");
	try {
		const other = crypto.randomUUID();
		f.ask(other);
		expect((await caller.workspaceAnswerContinuationCapability(f.input)).status).toBe(
			"unavailable"
		);
		const row = (await caller.workspaceList()).items.find(
			(item) => item.id === questionSourceId(other)
		);
		if (!row) throw Error("Other question missing");
		expect(
			(
				await caller.workspaceAnswer({
					id: row.id,
					revision: row.revision,
					questionId: other,
					content: "Green",
				})
			).status
		).toBe("saved");
		expect((await caller.workspaceAnswerContinuationCapability(f.input)).status).toBe(
			"unavailable"
		);
		expect(f.writes).toHaveLength(0);
	} finally {
		f.manager.dispose();
	}
});

test("a legacy reply-only daemon exposes save-only fallback without answer continuation", async () => {
	const f = await fixture("codex", "worktree");
	try {
		f.daemon.supportsQueueAnswer = false;
		expect((await caller.workspaceAnswerContinuationCapability(f.input)).status).toBe(
			"unavailable"
		);
		const result = await caller.workspaceAnswerAndContinue(f.input);
		expect(result.answer?.delivery).toBe("saved");
		expect(result.continuation.status).toBe("unavailable");
		expect(f.writes).toHaveLength(0);
	} finally {
		f.manager.dispose();
	}
});
