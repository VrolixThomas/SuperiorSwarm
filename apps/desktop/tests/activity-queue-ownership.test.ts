import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { questionSourceId, workspaceSourceId } from "../src/main/activity-queue/agent-source";
import {
	bringBack,
	later,
	listWorkspaceQueue,
	undoDone,
	workspaceAnswer,
	workspaceDone,
} from "../src/main/activity-queue/workspace-queue";
import { setEventsDir } from "../src/main/control-plane/orchestrator-event-sink";
import { getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	crossRepoOrchestrators,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import {
	type CallerContext,
	readMessages,
	sendMessage,
	setStatus,
} from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
beforeAll(() => {
	setupTestDb();
	setEventsDir(mkdtempSync(join(tmpdir(), "queue-ownership-events-")));
});

async function fixture(coordinator: boolean, provider: "claude" | "codex") {
	const projectId = await seedProject();
	const id = coordinator
		? await seedCrossRepoOrchestrator({ projectIds: [projectId] })
		: await seedWorkspace(projectId, { name: "Owner" });
	const terminalId = `terminal-${id}`;
	for (const terminal of [terminalId, `${terminalId}-sibling`]) {
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminal,
				workspaceId: id,
				title: terminal,
				cwd: "/tmp",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
		getDb()
			.insert(agentSessions)
			.values({
				terminalId: terminal,
				workspaceId: id,
				provider,
				providerSessionId: `conversation-${terminal}`,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();
	}
	const ctx: CallerContext = coordinator
		? { kind: "xro", xroId: id, linkedProjectIds: [projectId], terminalId }
		: { kind: "workspace", projectId, workspaceId: id, terminalId };
	const inventory = {
		isConnected: true,
		ids: [terminalId, `${terminalId}-sibling`],
		async listSessionsStrict() {
			return this.ids.map((id) => ({ id, cwd: "/tmp", pid: 1 }));
		},
	};
	const items = async () =>
		(await listWorkspaceQueue({}, inventory)).items.filter((row) => row.context.workspaceId === id);
	return { id, projectId, terminalId, ctx, inventory, items };
}
for (const provider of ["claude", "codex"] as const)
	for (const coordinator of [false, true]) {
		test(`${provider}/${coordinator ? "coordinator" : "workspace"}: correlated reply is saved, isolated and retired only on exact MCP retrieval`, async () => {
			const f = await fixture(coordinator, provider);
			await sendMessage(f.ctx, { kind: "question", content: "Choose amber or blue" });
			const item = (await f.items())[0]!;
			expect(item.question?.replyCapability).toBe("mcp-inbox");
			const request = {
				id: item.id,
				revision: item.revision,
				questionId: item.question!.messageId,
				content: "Amber",
			};
			expect((await workspaceAnswer({ ...request, questionId: "wrong" }, f.inventory)).status).toBe(
				"conflict"
			);
			expect(
				(await workspaceAnswer({ ...request, revision: request.revision + 1 }, f.inventory)).status
			).toBe("conflict");
			const saved = await workspaceAnswer(request, f.inventory);
			expect(saved.status).toBe("saved");
			expect((await f.items())[0]?.question?.answer?.delivery).toBe("saved");
			const sibling = await readMessages(
				{ ...f.ctx, terminalId: `${f.terminalId}-sibling` },
				{ includeBroadcasts: false }
			);
			expect(sibling.messages).toHaveLength(0);
			const legacy = await readMessages(
				{ ...f.ctx, terminalId: undefined },
				{ includeBroadcasts: false }
			);
			expect(legacy.messages).toHaveLength(0);
			expect((await workspaceAnswer(request, f.inventory)).status).toBe("conflict");
			expect((await f.items()).length).toBe(1);
			const delivered = await readMessages(f.ctx, { includeBroadcasts: false });
			expect(delivered.messages).toHaveLength(1);
			expect(delivered.messages[0]?.content).toBe("Amber");
			expect(delivered.messages[0]?.inReplyTo).toBe(request.questionId);
			expect(await f.items()).toHaveLength(0);
			expect(
				getDb().select().from(agentMessages).where(eq(agentMessages.id, request.questionId)).get()
			).toBeDefined();
		});
		test(`${provider}/${coordinator ? "coordinator" : "workspace"}: closed/replaced question owner cannot receive or mutate`, async () => {
			const f = await fixture(coordinator, provider);
			await sendMessage(f.ctx, { kind: "question", content: "Synthetic decision" });
			const item = (await f.items())[0]!;
			getDb()
				.update(agentSessions)
				.set({ providerSessionId: "replacement" })
				.where(eq(agentSessions.terminalId, f.terminalId))
				.run();
			expect(await f.items()).toHaveLength(0);
			expect(
				(
					await workspaceAnswer(
						{
							id: item.id,
							revision: item.revision,
							questionId: item.question!.messageId,
							content: "No",
						},
						f.inventory
					)
				).status
			).toBe("conflict");
			// Known generation remains history; a sibling cannot keep it current.
			expect(
				getDb()
					.select()
					.from(agentMessages)
					.where(eq(agentMessages.id, item.question!.messageId))
					.get()
			).toBeDefined();
		});
	}

test("report and turn receipt group atomically; stale member rejects all actions and Undo retains exact revisions", async () => {
	const f = await fixture(false, "codex");
	const manager = new AgentSessionManager({
		daemonClient: {} as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	try {
		manager.handleAgentEvent({
			terminalId: f.terminalId,
			sessionId: f.terminalId,
			workspaceId: f.id,
			providerSessionId: `conversation-${f.terminalId}`,
			agent: "codex",
			alert: "task-complete",
			rawEvent: "Stop",
			turnId: "first",
			timestamp: Date.now(),
			producerTimestamp: Date.now(),
			cwd: "/tmp",
		});
		await setStatus(f.ctx, { phase: "done", statusText: "Synthetic result" });
		const item = (await f.items())[0]!;
		expect(await f.items()).toHaveLength(1);
		expect(item.members).toHaveLength(2);
		expect(
			(await workspaceDone({ id: item.id, revision: item.revision }, f.inventory)).status
		).toBe("conflict");
		const input = { id: item.id, revision: item.revision, members: item.members };
		expect((await later({ ...input, untilChange: true }, f.inventory)).status).toBe("snoozed");
		expect(
			(await listWorkspaceQueue({ view: "later" }, f.inventory)).items.filter(
				(row) => row.context.workspaceId === f.id
			)
		).toHaveLength(1);
		expect((await bringBack(input, f.inventory)).status).toBe("restored");
		expect(
			(
				await workspaceDone(
					{ ...input, members: item.members!.map((m, i) => ({ ...m, revision: m.revision + i })) },
					f.inventory
				)
			).status
		).toBe("conflict");
		expect(await f.items()).toHaveLength(1);
		expect((await workspaceDone(input, f.inventory)).status).toBe("acknowledged");
		expect(await f.items()).toHaveLength(0);
		expect((await undoDone(input, f.inventory)).status).toBe("restored");
		expect(await f.items()).toHaveLength(1);
	} finally {
		manager.dispose();
	}
});

test("legacy question/report remains explicitly unavailable for safe reply and never binds to sibling", async () => {
	const f = await fixture(false, "claude");
	const q = await sendMessage(
		{ ...f.ctx, terminalId: undefined },
		{ kind: "question", content: "Legacy question" }
	);
	const item = (await f.items()).find((row) => row.id === questionSourceId(q.messageId))!;
	expect(item.context.identityCapability).toBe("missing-owner");
	expect(item.question?.replyCapability).toBe("unavailable");
	expect(
		(
			await workspaceAnswer(
				{ id: item.id, revision: item.revision, questionId: q.messageId, content: "No" },
				f.inventory
			)
		).status
	).toBe("unavailable");
	await setStatus({ ...f.ctx, terminalId: undefined }, { phase: "blocked", needs: "Legacy" });
	expect(
		(await f.items()).find((row) => row.id === workspaceSourceId(f.id))?.context.identityCapability
	).toBe("missing-owner");
});

test("polymorphic session constraints reject nonexistent owners and cascade both real entity kinds", async () => {
	for (const coordinator of [false, true]) {
		const f = await fixture(coordinator, "codex");
		expect(() =>
			getDb()
				.update(agentSessions)
				.set({ workspaceId: "nonexistent" })
				.where(eq(agentSessions.terminalId, f.terminalId))
				.run()
		).toThrow("unknown agent entity");
		if (coordinator)
			getDb().delete(crossRepoOrchestrators).where(eq(crossRepoOrchestrators.id, f.id)).run();
		else getDb().delete(workspaces).where(eq(workspaces.id, f.id)).run();
		expect(
			getDb().select().from(agentSessions).where(eq(agentSessions.terminalId, f.terminalId)).get()
		).toBeUndefined();
	}
});
