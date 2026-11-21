import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { workspaceReporter } from "../src/main/activity-queue/agent-source";
import { queueEntities } from "../src/main/activity-queue/entities";
import { listWorkspaceQueue, workspaceAnswer } from "../src/main/activity-queue/workspace-queue";
import { setEventsDir } from "../src/main/control-plane/orchestrator-event-sink";
import { getDb } from "../src/main/db";
import {
	agentMessages,
	crossRepoOrchestrators,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import {
	readMessages,
	sendMessage,
	setStatus,
	type CallerContext,
} from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import type { AgentEvent } from "../src/shared/agent-events";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(() => {
	setupTestDb();
	setEventsDir(mkdtempSync(join(tmpdir(), "postpatch-queue-events-")));
});
async function scenario(provider: "claude" | "codex", kind: string, managed: boolean) {
	const projectId = await seedProject();
	const folderId = await seedProject();
	getDb().update(projects).set({ kind: "folder" }).where(eq(projects.id, folderId)).run();
	const id =
		kind === "coordinator"
			? await seedCrossRepoOrchestrator({ projectIds: [projectId, folderId] })
			: await seedWorkspace(kind === "folder" ? folderId : projectId, {
					name: `Independent ${kind}`,
					isOrchestrator: kind === "orchestrator",
				});
	if (kind === "folder")
		getDb()
			.update(workspaces)
			.set({ type: "folder", folderPath: "/tmp/postpatch-folder" })
			.where(eq(workspaces.id, id))
			.run();
	const owner = `owner-${id}`,
		sibling = `sibling-${id}`;
	const manager = new AgentSessionManager({
		daemonClient: {} as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	for (const terminalId of [owner, sibling])
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId: id,
				cwd: "/tmp",
				title: terminalId,
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
	if (managed)
		manager.registerManagedSession({
			workspaceId: id,
			terminalId: owner,
			provider,
			providerSessionId: `session-${owner}`,
			skipPermissions: false,
		});
	let clock = Date.now();
	const event = (rawEvent: string, turnId: string, terminalId = owner): AgentEvent => ({
		agent: provider,
		workspaceId: id,
		terminalId,
		sessionId: terminalId,
		providerSessionId: `session-${terminalId}`,
		rawEvent,
		sessionSource: rawEvent === "SessionStart" ? "startup" : undefined,
		turnId,
		alert: rawEvent === "Stop" ? "task-complete" : "active",
		timestamp: ++clock,
		producerTimestamp: clock,
		cwd: "/tmp",
	});
	const ctx: CallerContext =
		kind === "coordinator"
			? { kind: "xro", xroId: id, linkedProjectIds: [projectId, folderId], terminalId: owner }
			: {
					kind: "workspace",
					projectId: kind === "folder" ? folderId : projectId,
					workspaceId: id,
					terminalId: owner,
				};
	const inventory = {
		isConnected: true,
		ids: [owner, sibling],
		async listSessionsStrict() {
			return this.ids.map((id) => ({ id, cwd: "/tmp", pid: 1 }));
		},
	};
	const items = async () =>
		(await listWorkspaceQueue({}, inventory)).items.filter((i) => i.context.workspaceId === id);
	return { id, projectId, folderId, owner, sibling, manager, event, ctx, inventory, items };
}
for (const provider of ["claude", "codex"] as const)
	for (const kind of ["worktree", "folder", "orchestrator", "coordinator"])
		for (const managed of [false, true]) {
			test(`independent ${provider}/${kind}/${managed ? "managed" : "manual"}: exact owner, grouped completion, sibling isolation and continuation`, async () => {
				const s = await scenario(provider, kind, managed);
				try {
					expect(s.manager.handleAgentEvent(s.event("SessionStart", ""))).not.toBeNull();
					s.manager.handleAgentEvent(s.event("UserPromptSubmit", "first"));
					s.manager.handleAgentEvent(s.event("Stop", "first"));
					await setStatus(s.ctx, {
						phase: "done",
						statusText: "Synthetic task complete: amber selected",
					});
					const pending = await s.items();
					expect(pending).toHaveLength(1);
					expect(pending[0]?.members).toHaveLength(2);
					expect(pending[0]?.target).toMatchObject({
						type: "terminal",
						terminalId: s.owner,
						provider,
						providerSessionId: `session-${s.owner}`,
						entity: { kind: kind === "coordinator" ? "coordinator" : "workspace", id: s.id },
					});
					expect(pending[0]?.evidence).toContain("Synthetic task complete: amber selected");
					if (kind === "coordinator")
						expect(pending[0]?.context.linkedProjects?.map((p) => p.kind).sort()).toEqual([
							"folder",
							"repo",
						]);
					expect(await s.items()).toHaveLength(1);
					s.manager.handleAgentEvent(s.event("SessionStart", "", s.sibling));
					s.manager.handleAgentEvent(s.event("UserPromptSubmit", "other", s.sibling));
					expect(await s.items()).toHaveLength(1);
					await Bun.sleep(8);
					const next = s.event("UserPromptSubmit", "second");
					next.timestamp = next.producerTimestamp = Date.now();
					s.manager.handleAgentEvent(next);
					expect(await s.items()).toHaveLength(0);
					const replay = s.event("Stop", "first");
					replay.timestamp = Date.now() + 1;
					s.manager.handleAgentEvent(replay);
					expect(await s.items()).toHaveLength(0);
					const complete = s.event("Stop", "second");
					complete.timestamp = Date.now() + 2;
					s.manager.handleAgentEvent(complete);
					expect(await s.items()).toHaveLength(1);
					s.inventory.ids = [s.sibling];
					expect(await s.items()).toHaveLength(0);
				} finally {
					s.manager.dispose();
				}
			});
		}

test("all-projects coordinator context includes dynamically authorized repo and folder", async () => {
	const s = await scenario("codex", "coordinator", false);
	try {
		const id = await seedCrossRepoOrchestrator({ projectIds: [] });
		getDb()
			.update(crossRepoOrchestrators)
			.set({ accessScope: "all" })
			.where(eq(crossRepoOrchestrators.id, id))
			.run();
		const linked = queueEntities()
			.get(id)
			?.context.linkedProjects?.map((p) => p.id);
		expect(linked).toContain(s.projectId);
		expect(linked).toContain(s.folderId);
	} finally {
		s.manager.dispose();
	}
});

test("recipient inbox pagination cannot starve an older unread answer behind sibling-only answers", async () => {
	const s = await scenario("claude", "folder", false);
	try {
		s.manager.handleAgentEvent(s.event("SessionStart", ""));
		s.manager.handleAgentEvent(s.event("SessionStart", "", s.sibling));
		await sendMessage(s.ctx, { kind: "question", content: "Choose amber or blue" });
		const q = (await s.items())[0];
		if (!q?.question) throw new Error("Missing owned question");
		expect(
			(
				await workspaceAnswer(
					{ id: q.id, revision: q.revision, questionId: q.question.messageId, content: "Amber" },
					s.inventory
				)
			).status
		).toBe("saved");
		const recipient = workspaceReporter(s.id, s.sibling);
		if (!recipient) throw new Error("Missing sibling");
		for (let n = 0; n < 201; n++)
			getDb()
				.insert(agentMessages)
				.values({
					id: `sibling-message-${s.id}-${n}`,
					projectId: s.folderId,
					fromWorkspaceId: null,
					toWorkspaceId: s.id,
					recipient,
					kind: "answer",
					content: "Unrelated sibling answer",
					createdAt: new Date(Date.now() + 100 + n),
				})
				.run();
		const inbox = await readMessages(
			{ ...s.ctx, deferQueueRetrieval: true },
			{ includeBroadcasts: false }
		);
		expect(
			inbox.messages.some((m) => m.inReplyTo === q.question?.messageId && m.content === "Amber")
		).toBe(true);
	} finally {
		s.manager.dispose();
	}
});

test("cross-repo coordinator accepts the production dispatch service with an isolated launch target", async () => {
	const { dispatchAgent } = await import("../src/main/services/workspace-service");
	const id = await seedCrossRepoOrchestrator({
		workDir: mkdtempSync(join(tmpdir(), "postpatch-dispatch-")),
	});
	let spawned = false;
	const result = await dispatchAgent(
		{
			workspaceId: id,
			cliPreset: "codex",
			skipPermissions: false,
			prompt: "Return only SYNTHETIC_DONE; do not use tools",
		},
		{
			spawnFn: async (args) => {
				spawned = true;
				expect(args.workspaceId).toBe(id);
				expect(args.agent?.skipPermissions).toBe(false);
				return { sessionId: "synthetic-dispatch", terminalId: "synthetic-dispatch" };
			},
		}
	);
	expect(spawned).toBe(true);
	expect(result).toBeDefined();
});
