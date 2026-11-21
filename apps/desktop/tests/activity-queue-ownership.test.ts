import { ActivityQueueService } from "../src/main/activity-queue/service";
import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
	observeValidatedAgentEvent,
	questionSourceId,
	workspaceSourceId,
} from "../src/main/activity-queue/agent-source";
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
				entityKind: coordinator ? "coordinator" : "workspace",
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

test("wrong project, sibling, timestamp and recipient cannot poison reply metadata or resolution", async () => {
	const f = await fixture(false, "codex");
	const { messageId } = await sendMessage(f.ctx, { kind: "question", content: "Exact routing?" });
	const question = getDb()
		.select()
		.from(agentMessages)
		.where(eq(agentMessages.id, messageId))
		.get()!;
	if (question.reporter?.type !== "terminal") throw new Error("Missing reporter");
	const otherProject = await seedProject();
	const base = {
		projectId: f.projectId,
		kind: "answer" as const,
		content: "Wrong answer",
		inReplyTo: messageId,
		toWorkspaceId: f.id,
		recipient: question.reporter,
		createdAt: new Date(),
		retrievedAt: new Date(),
	};
	for (const [index, override] of [
		{ projectId: otherProject },
		{
			recipient: {
				...question.reporter,
				terminalId: `${f.terminalId}-sibling`,
				providerSessionId: `conversation-${f.terminalId}-sibling`,
			},
		},
		{ createdAt: new Date(question.createdAt.getTime() - 1) },
		{ toWorkspaceId: null },
		{ recipient: { ...question.reporter, providerSessionId: "old-generation" } },
	].entries())
		getDb()
			.insert(agentMessages)
			.values({ ...base, ...override, id: `wrong-${messageId}-${index}` })
			.run();
	const item = (await f.items())[0]!;
	expect(item.question?.answer).toBeUndefined();
	expect(
		(
			await workspaceAnswer(
				{ id: item.id, revision: item.revision, questionId: messageId, content: "Valid answer" },
				f.inventory
			)
		).status
	).toBe("saved");
	const saved = (await f.items())[0]!;
	expect(saved.question?.answer?.delivery).toBe("saved");
	await readMessages(f.ctx, { includeBroadcasts: false });
	expect(await f.items()).toHaveLength(0);
});

test("ordinary MCP correlated answer routes to coordinator owner and waits for exact retrieval", async () => {
	const f = await fixture(true, "claude");
	await sendMessage(f.ctx, { kind: "question", content: "Coordinator decision" });
	const item = (await f.items())[0]!;
	const child = await seedWorkspace(f.projectId, { name: "Replying child" });
	await sendMessage(
		{ kind: "workspace", workspaceId: child, projectId: f.projectId },
		{
			kind: "answer",
			inReplyTo: item.question!.messageId,
			toWorkspaceId: f.id,
			content: "Synthetic reply",
		}
	);
	expect((await f.items())[0]?.question?.answer?.delivery).toBe("saved");
	expect(
		(
			await readMessages(
				{ ...f.ctx, terminalId: `${f.terminalId}-sibling` },
				{ includeBroadcasts: false }
			)
		).messages
	).toHaveLength(0);
	expect((await readMessages(f.ctx, { includeBroadcasts: false })).messages[0]?.content).toBe(
		"Synthetic reply"
	);
	expect(await f.items()).toHaveLength(0);
});

test("grouped report retains reply provenance and member errors; delayed member acknowledgment rejects Later atomically", async () => {
	const f = await fixture(false, "codex");
	observeValidatedAgentEvent({
		terminalId: f.terminalId,
		sessionId: f.terminalId,
		workspaceId: f.id,
		providerSessionId: `conversation-${f.terminalId}`,
		agent: "codex",
		alert: "task-complete",
		rawEvent: "Stop",
		turnId: "first",
		timestamp: Date.now(),
		cwd: "/tmp",
		evidence: [
			{
				kind: "reply",
				sourceField: "last_assistant_message",
				text: "Synthetic provider reply",
				provider: "codex",
				rawEvent: "Stop",
				truncated: false,
				redacted: false,
			},
		],
	});
	await setStatus(f.ctx, { phase: "done", statusText: "Synthetic task report" });
	const item = (await f.items())[0]!;
	expect(item.members).toHaveLength(2);
	expect(item.providerEvidence?.[0]).toMatchObject({
		text: "Synthetic provider reply",
		provider: "codex",
		rawEvent: "Stop",
	});
	const turn = item.members!.find((member) => member.id !== item.id)!;
	expect((await workspaceDone(turn, f.inventory)).status).toBe("conflict");
	let release!: () => void;
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const blocked = {
		isConnected: true,
		async listSessionsStrict() {
			entered();
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return f.inventory.listSessionsStrict();
		},
	};
	const pending = later(
		{ id: item.id, revision: item.revision, members: item.members, untilChange: true },
		blocked
	);
	await started;
	new ActivityQueueService().acknowledge(turn);
	release();
	expect((await pending).status).toBe("conflict");
	expect(
		(await listWorkspaceQueue({ view: "later" }, f.inventory)).items.filter(
			(row) => row.context.workspaceId === f.id
		)
	).toHaveLength(0);
	expect((await f.items()).find((row) => row.id === item.id)?.acknowledged).toBe(false);
	// Restore the separate member and verify grouped stale/error presentation.
	expect((await undoDone(turn, f.inventory)).status).toBe("restored");
	getDb()
		.update(agentSessions)
		.set({ state: "error", lastError: "Synthetic transport error" })
		.where(eq(agentSessions.terminalId, f.terminalId))
		.run();
	const grouped = await listWorkspaceQueue({}, f.inventory);
	expect(grouped.items.find((row) => row.id === item.id)?.stale).toBe(true);
	expect(grouped.sourceErrors.find((error) => error.sourceId === turn.id)?.error).toBe(
		"Synthetic transport error"
	);
	expect(
		(
			await workspaceDone(
				{ id: item.id, revision: item.revision, members: item.members },
				f.inventory
			)
		).status
	).toBe("conflict");
});
