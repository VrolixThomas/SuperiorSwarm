import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
	observeValidatedAgentEvent,
	questionSourceId,
	reconcileAgentSources,
	workspaceSourceId,
} from "../src/main/activity-queue/agent-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { claudeConfig } from "../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../src/main/agent-hooks/agents/codex";
import { createAlertListener } from "../src/main/agent-hooks/listener";
import { closeDb, getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import { sendMessage, setStatus } from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { getDaemonClient, setDaemonClient } from "../src/main/terminal/daemon-instance";
import { activityQueueRouter } from "../src/main/trpc/routers/activity-queue";
import { workspacesRouter } from "../src/main/trpc/routers/workspaces";
import { agentRegistry } from "../src/shared/agent-events";
import type { AgentEvent } from "../src/shared/agent-events";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

let projectId: string;
let workspaceId: string;
beforeAll(setupTestDb);
beforeEach(async () => {
	const db = getDb();
	db.delete(activityQueueSources).run();
	db.delete(agentSessions).run();
	db.delete(agentMessages).run();
	db.delete(terminalSessions).run();
	db.delete(workspaces).run();
	db.delete(projects).run();
	projectId = await seedProject();
	workspaceId = await seedWorkspace(projectId, { name: "Agent" });
});
function queue() {
	return new ActivityQueueService();
}
function event(terminalId: string, alert: AgentEvent["alert"] = "task-complete"): AgentEvent {
	return {
		terminalId,
		sessionId: terminalId,
		workspaceId,
		providerSessionId: `${terminalId}-provider`,
		agent: "codex",
		alert,
		timestamp: Date.now(),
		cwd: "/tmp",
	};
}
function manager() {
	return new AgentSessionManager({
		daemonClient: {} as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
}
function register(agent: AgentSessionManager, terminalId: string) {
	getDb()
		.insert(terminalSessions)
		.values({
			id: terminalId,
			workspaceId,
			title: terminalId,
			cwd: "/tmp",
			sortOrder: 0,
			updatedAt: new Date(),
		})
		.onConflictDoNothing()
		.run();
	agent.registerManagedSession({
		terminalId,
		workspaceId,
		provider: "codex",
		providerSessionId: `${terminalId}-provider`,
		skipPermissions: false,
	});
}

test("idle shell is not ready; explicit blocked and done are durable and working resolves", async () => {
	reconcileAgentSources();
	expect(queue().list().items).toHaveLength(0);
	const ctx = { kind: "workspace" as const, projectId, workspaceId };
	await setStatus(ctx, { phase: "blocked", needs: "Choose a branch" });
	const item = queue().list().items[0];
	expect(item?.kind).toBe("agent-input");
	expect(item?.summary).toBe("Choose a branch");
	queue().acknowledge({ id: item?.id ?? "", revision: item?.revision ?? 0 });
	await setStatus(ctx, { phase: "blocked", needs: "Choose a branch" });
	expect(queue().list().totalPending).toBe(0);
	await setStatus(ctx, { phase: "working" });
	await setStatus(ctx, { phase: "blocked", needs: "Choose a branch" });
	expect(queue().list().totalPending).toBe(1);
	await setStatus(ctx, { phase: "done", statusText: "Implemented" });
	expect(queue().read(workspaceSourceId(workspaceId))?.candidate?.reasons[0]?.label).toBe(
		"Task complete"
	);
	closeDb();
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(1);
	await setStatus(ctx, { phase: "working" });
	expect(queue().list().totalPending).toBe(0);
});

test("answers resolve only their exact question; opening and reconciling do not handle", () => {
	const db = getDb();
	for (const id of ["q1", "q2"])
		db.insert(agentMessages)
			.values({
				id,
				projectId,
				fromWorkspaceId: workspaceId,
				kind: "question",
				content: id,
				createdAt: new Date(),
			})
			.run();
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(2);
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(2);
	db.insert(agentMessages)
		.values({
			id: "a1",
			projectId,
			fromWorkspaceId: workspaceId,
			kind: "answer",
			content: "Answer",
			inReplyTo: "q1",
			createdAt: new Date(),
		})
		.run();
	reconcileAgentSources();
	expect(
		queue()
			.list()
			.items.map((item) => item.id)
	).toEqual([questionSourceId("q2")]);
});

test("two terminals remain independent; Stop means next input and active clears only that session", () => {
	const agent = manager();
	register(agent, "one");
	register(agent, "two");
	agent.handleAgentEvent(event("one", "needs-input"));
	agent.handleAgentEvent(event("two"));
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(2);
	expect(queue().list().items[1]?.summary).toBe("Ready for next input");
	const before = queue().list().items[1];
	agent.handleAgentEvent(event("two"));
	expect(queue().list().items[1]?.revision).toBe(before?.revision);
	closeDb();
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(2);
	agent.handleAgentEvent(event("two", "active"));
	reconcileAgentSources();
	expect(
		queue()
			.list()
			.items.map((item) => item.target)
	).toEqual([
		{
			type: "terminal",
			workspaceId,
			terminalId: "one",
			entity: { kind: "workspace", id: workspaceId },
			provider: "codex",
			providerSessionId: "one-provider",
		},
	]);
	agent.dispose();
});

for (const provider of ["codex", "claude"] as const) {
	test(`${provider}: direct chat input clears dispatched attention and identical later completion returns`, async () => {
		const agent = manager();
		register(agent, "dispatched");
		getDb()
			.update(agentSessions)
			.set({ provider })
			.where(eq(agentSessions.terminalId, "dispatched"))
			.run();
		const ctx = { kind: "workspace" as const, projectId, workspaceId, terminalId: "dispatched" };
		let stamp = Date.now() + 1;
		const deliver = (rawEvent: string, turnId: string, alert: AgentEvent["alert"]) => {
			stamp = Math.max(stamp + 1, Date.now() + 1);
			return agent.handleAgentEvent({
				...event("dispatched", alert),
				agent: provider,
				rawEvent,
				turnId,
				timestamp: stamp,
				producerTimestamp: stamp,
			});
		};
		try {
			for (const phase of ["done", "blocked"] as const) {
				deliver("UserPromptSubmit", `${phase}-first`, "active");
				await setStatus(ctx, {
					phase,
					statusText: "Review result",
					...(phase === "blocked" ? { needs: "Choose approach" } : {}),
				});
				deliver("Stop", `${phase}-first`, "task-complete");
				const old = queue().read(workspaceSourceId(workspaceId));
				expect(queue().list().totalPending).toBe(2);
				// Reads and navigation lookups are not acknowledgements.
				await workspacesRouter.createCaller({}).getById({ id: workspaceId });
				reconcileAgentSources();
				expect(queue().list().totalPending).toBe(2);
				deliver("UserPromptSubmit", `${phase}-followup`, "active");
				reconcileAgentSources();
				expect(queue().list().totalPending).toBe(0);
				expect(
					getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()
						?.currentPhase
				).toBe("working");
				closeDb();
				reconcileAgentSources();
				expect(queue().list().totalPending).toBe(0);
				await setStatus(ctx, {
					phase,
					statusText: "Review result",
					...(phase === "blocked" ? { needs: "Choose approach" } : {}),
				});
				deliver("Stop", `${phase}-followup`, "task-complete");
				reconcileAgentSources();
				expect(queue().list().totalPending).toBe(2);
				expect(queue().read(workspaceSourceId(workspaceId))?.revision).toBeGreaterThan(
					old?.revision ?? 0
				);
				// A redelivered prompt from the completed turn must not clear new attention.
				expect(deliver("UserPromptSubmit", `${phase}-followup`, "active")).toBeNull();
				expect(queue().list().totalPending).toBe(2);
			}
		} finally {
			agent.dispose();
		}
	});
}

test("direct input in a sibling chat and background tool activity leave dispatched reports pending", async () => {
	const agent = manager();
	register(agent, "sibling");
	register(agent, "dispatched"); // Only the current dispatch owns workspace status.
	const ctx = { kind: "workspace" as const, projectId, workspaceId };
	try {
		await setStatus(ctx, { phase: "blocked", needs: "Explicit decision" });
		for (const [terminalId, rawEvent] of [
			["sibling", "UserPromptSubmit"],
			["dispatched", "PreToolUse"],
			["dispatched", "SessionStart"],
		]) {
			agent.handleAgentEvent({
				...event(terminalId ?? "", "active"),
				rawEvent,
				turnId: "turn",
				producerTimestamp: Date.now(),
			});
			reconcileAgentSources();
			expect(queue().read(workspaceSourceId(workspaceId))?.candidate).not.toBeNull();
		}
	} finally {
		agent.dispose();
	}
});

test("a prompt produced before a newer workspace report cannot clear it on delayed delivery", async () => {
	const agent = manager();
	register(agent, "dispatched");
	try {
		const producedAt = Date.now();
		agent.handleAgentEvent({
			...event("dispatched"),
			rawEvent: "Stop",
			turnId: "old-turn",
			producerTimestamp: producedAt,
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		await setStatus(
			{ kind: "workspace", projectId, workspaceId },
			{ phase: "blocked", needs: "Newer decision" }
		);
		closeDb();
		reconcileAgentSources();
		agent.handleAgentEvent({
			...event("dispatched", "active"),
			rawEvent: "UserPromptSubmit",
			turnId: "delayed-turn",
			producerTimestamp: producedAt,
		});
		reconcileAgentSources();
		expect(queue().read(workspaceSourceId(workspaceId))?.candidate?.summary).toBe("Newer decision");
	} finally {
		agent.dispose();
	}
});

test("typing and waking to read do not resolve session attention before a provider continuation", async () => {
	const agent = manager();
	register(agent, "dispatched");
	try {
		agent.handleAgentEvent({ ...event("dispatched"), rawEvent: "Stop", turnId: "finished-turn" });
		const item = queue().list().items[0];
		await agent.beforeTerminalInput("dispatched");
		reconcileAgentSources();
		expect(queue().list().items[0]?.revision).toBe(item?.revision);
		expect(queue().list().totalPending).toBe(1);
		// Visibility/wake can optimistically mark running before SessionStart.
		getDb()
			.update(agentSessions)
			.set({ state: "resuming" })
			.where(eq(agentSessions.terminalId, "dispatched"))
			.run();
		reconcileAgentSources();
		expect(queue().list().totalPending).toBe(1);
		agent.handleAgentEvent({
			...event("dispatched", "active"),
			rawEvent: "SessionStart",
			sessionSource: "resume",
			turnId: "finished-turn",
		});
		reconcileAgentSources();
		expect(queue().list().items[0]?.revision).toBe(item?.revision);
		expect(queue().list().totalPending).toBe(1);
		agent.handleAgentEvent({
			...event("dispatched", "active"),
			rawEvent: "UserPromptSubmit",
			turnId: "new-turn",
		});
		reconcileAgentSources();
		expect(queue().list().totalPending).toBe(0);
	} finally {
		agent.dispose();
	}
});

test("ordinary chat input does not invent an answer; only a reply delivered to the asker resolves the question", async () => {
	const agent = manager();
	register(agent, "dispatched");
	const other = await seedWorkspace(projectId, { name: "Responder" });
	const third = await seedWorkspace(projectId, { name: "Unrelated recipient" });
	getDb()
		.insert(agentMessages)
		.values({
			id: "direct-question",
			projectId,
			fromWorkspaceId: workspaceId,
			toWorkspaceId: other,
			kind: "question",
			content: "Which approach?",
			createdAt: new Date(),
		})
		.run();
	try {
		agent.handleAgentEvent({
			...event("dispatched", "active"),
			rawEvent: "UserPromptSubmit",
			turnId: "new-turn",
		});
		reconcileAgentSources();
		expect(
			queue()
				.list()
				.items.map((item) => item.id)
		).toContain(questionSourceId("direct-question"));
		const ctx = { kind: "workspace" as const, projectId, workspaceId: other };
		await sendMessage(ctx, {
			kind: "answer",
			toWorkspaceId: third,
			inReplyTo: "direct-question",
			content: "Wrong recipient",
		});
		reconcileAgentSources();
		expect(
			queue()
				.list()
				.items.map((item) => item.id)
		).toContain(questionSourceId("direct-question"));
		await sendMessage(ctx, {
			kind: "answer",
			toWorkspaceId: workspaceId,
			inReplyTo: "direct-question",
			content: "Use approach A",
		});
		reconcileAgentSources();
		expect(
			queue()
				.list()
				.items.map((item) => item.id)
		).not.toContain(questionSourceId("direct-question"));
	} finally {
		agent.dispose();
	}
});

test("missing/mismatched identities never create or clear attention", () => {
	const agent = manager();
	register(agent, "one");
	agent.handleAgentEvent(event("one", "needs-input"));
	for (const invalid of [
		{ ...event("one", "active"), workspaceId: "wrong" },
		{ ...event("one", "active"), providerSessionId: "old-provider" },
		{ ...event("one", "active"), agent: "claude" },
		{ ...event("", "active"), providerSessionId: "" },
		{ ...event("missing"), providerSessionId: "" },
	]) {
		expect(observeValidatedAgentEvent(invalid)).toBe(false);
		agent.handleAgentEvent(invalid);
	}
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(1);
	expect(agent.getSession("one")?.state).toBe("needs-input");
	agent.dispose();
});

test("unique provider identity is accepted, ambiguous provider identity is rejected", () => {
	const agent = manager();
	register(agent, "one");
	const byProvider = { ...event("one", "needs-input"), terminalId: "", sessionId: "" };
	expect(observeValidatedAgentEvent(byProvider)).toBe(true);
	register(agent, "two");
	getDb()
		.update(agentSessions)
		.set({ providerSessionId: "one-provider" })
		.where(eq(agentSessions.terminalId, "two"))
		.run();
	expect(observeValidatedAgentEvent(byProvider)).toBe(false);
	agent.dispose();
});

test("newly persisted generic idle session is not treated as turn completion; deletion resolves", () => {
	const agent = manager();
	register(agent, "one");
	getDb()
		.update(agentSessions)
		.set({ state: "idle" })
		.where(eq(agentSessions.terminalId, "one"))
		.run();
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(0);
	agent.handleAgentEvent(event("one"));
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(1);
	getDb().delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
	reconcileAgentSources();
	expect(queue().list().totalPending).toBe(0);
	agent.dispose();
});

test("router checks authoritative revision before handling; exact terminal works without workspace hint", async () => {
	const previousDaemon = getDaemonClient();
	setDaemonClient({
		isConnected: true,
		listSessionsStrict: async () => [{ id: "one", cwd: "/tmp", pid: 1 }],
	} as DaemonClient);
	const agent = manager();
	register(agent, "one");
	try {
		const api = activityQueueRouter.createCaller({});
		const ctx = { kind: "workspace" as const, projectId, workspaceId };
		await setStatus(ctx, { phase: "blocked", needs: "First" });
		const displayed = (await api.list()).items[0];
		await setStatus(ctx, { phase: "blocked", needs: "Second" });
		expect(
			(await api.acknowledge({ id: displayed?.id ?? "", revision: displayed?.revision ?? 0 }))
				.status
		).toBe("conflict");
		expect((await api.list()).totalPending).toBe(1);
		await setStatus(ctx, { phase: "working" });
		agent.handleAgentEvent({ ...event("one", "needs-input"), workspaceId: "" });
		expect((await api.list()).items[0]?.kind).toBe("agent-input");
	} finally {
		agent.dispose();
		setDaemonClient(previousDaemon);
	}
});

test("restart bootstrap recovers explicit persisted needs-input but not generic idle", () => {
	const agent = manager();
	register(agent, "one");
	register(agent, "two");
	getDb()
		.update(agentSessions)
		.set({ state: "needs-input", lastEventAt: new Date() })
		.where(eq(agentSessions.terminalId, "one"))
		.run();
	getDb()
		.update(agentSessions)
		.set({ state: "idle", lastEventAt: new Date() })
		.where(eq(agentSessions.terminalId, "two"))
		.run();
	closeDb();
	reconcileAgentSources();
	expect(queue().list().items).toHaveLength(1);
	expect(queue().list().items[0]?.target).toMatchObject({ type: "terminal", terminalId: "one" });
	agent.dispose();
});

test("repeated turns reappear while duplicate and out-of-order events preserve current state", () => {
	const agent = manager();
	register(agent, "one");
	const start = Date.now();
	const deliver = (alert: AgentEvent["alert"], delta: number) =>
		agent.handleAgentEvent({ ...event("one", alert), timestamp: start + delta });
	deliver("task-complete", 1);
	const first = queue().list().items[0];
	queue().acknowledge({ id: first?.id ?? "", revision: first?.revision ?? 0 });
	const idleSince = agent.getSession("one")?.idleSince?.getTime();
	deliver("task-complete", 2);
	expect(agent.getSession("one")?.idleSince?.getTime()).toBe(idleSince);
	expect(queue().list().totalPending).toBe(0);
	deliver("active", 3);
	expect(deliver("task-complete", 1)).toBeNull();
	expect(agent.getSession("one")?.state).toBe("running");
	expect(queue().list().totalPending).toBe(0);
	deliver("task-complete", 4);
	expect(queue().list().items[0]?.revision).toBeGreaterThan(first?.revision ?? 0);
	expect(queue().list().totalPending).toBe(1);
	expect(deliver("active", 3)).toBeNull();
	expect(agent.getSession("one")?.state).toBe("idle");
	agent.dispose();
});

test("workspace navigation lookup exposes authoritative path and review identity", async () => {
	getDb()
		.update(workspaces)
		.set({
			type: "review",
			folderPath: "/tmp/review-cwd",
			prProvider: "github",
			prIdentifier: "42",
		})
		.where(eq(workspaces.id, workspaceId))
		.run();
	const api = workspacesRouter.createCaller({});
	expect(await api.getById({ id: workspaceId })).toMatchObject({
		path: "/tmp/review-cwd",
		prProvider: "github",
		prIdentifier: "42",
		type: "review",
	});
	expect(await api.getById({ id: "missing-workspace" })).toBeNull();
});

for (const provider of ["codex", "claude"] as const) {
	test(`${provider}: 55 turns through listener, manager and durable queue survive approvals, compaction and restart`, async () => {
		const agent = manager();
		register(agent, "one");
		getDb()
			.update(agentSessions)
			.set({ provider })
			.where(eq(agentSessions.terminalId, "one"))
			.run();
		agentRegistry.set(provider, provider === "codex" ? codexConfig : claudeConfig);
		const listener = createAlertListener(0, "lifecycle-token");
		await listener.start();
		let accepted = 0;
		listener.onEvent((incoming) => {
			if (agent.handleAgentEvent(incoming)) accepted++;
		});
		// Producer time is independent of receipt; it is retained when simulating delayed delivery.
		let produced = Date.now();
		const deliver = async (
			rawEvent: string,
			turn: number,
			time = ++produced,
			extra: Record<string, string> = {}
		) => {
			const query = new URLSearchParams({
				rawEvent,
				agent: provider,
				terminalId: "one",
				workspaceId,
				providerSessionId: "one-provider",
				producerTimestamp: String(time),
				...(provider === "codex" ? { turnId: `turn-${turn}` } : {}),
				...extra,
			});
			const response = await fetch(`http://127.0.0.1:${listener.getPort()}/event?${query}`, {
				headers: { Authorization: "Bearer lifecycle-token" },
			});
			expect(response.ok).toBe(true);
		};
		try {
			await deliver("SessionStart", 0, ++produced, { sessionSource: "startup" });
			let previousStop = 0;
			for (let turn = 1; turn <= 55; turn++) {
				await deliver("UserPromptSubmit", turn);
				expect(agent.getSession("one")?.state).toBe("running");
				expect(queue().list().totalPending).toBe(0);
				if (turn > 1) {
					const before = accepted;
					await deliver("Stop", turn - 1, previousStop);
					expect(accepted).toBe(before);
					expect(agent.getSession("one")?.state).toBe("running");
				}
				if (provider === "codex" && turn > 1 && turn % 15 === 0) {
					const before = accepted;
					await deliver("Stop", turn - 1); // later receipt AND producer time; stale turn identity wins
					expect(accepted).toBe(before);
				}
				await deliver("PreToolUse", turn);
				if (turn % 5 === 0) {
					await deliver("PermissionRequest", turn);
					expect(agent.getSession("one")?.state).toBe("needs-input");
					expect(queue().list().items[0]?.kind).toBe("agent-input");
				}
				await deliver("PostToolUse", turn);
				if (turn % 10 === 0) {
					await deliver("PreCompact", turn);
					await deliver("PostCompact", turn);
				}
				if (turn === 25) {
					closeDb();
					reconcileAgentSources();
				}
				previousStop = ++produced;
				await deliver("Stop", turn, previousStop);
				expect(agent.getSession("one")?.state).toBe("idle");
				const ready = queue().list().items[0];
				expect(ready?.summary).toBe("Ready for next input");
				queue().acknowledge({ id: ready?.id ?? "", revision: ready?.revision ?? 0 });
				await deliver("Stop", turn, previousStop);
				expect(queue().list().totalPending).toBe(0);
				if (turn % 10 === 0) {
					await deliver("PostCompact", turn);
					expect(agent.getSession("one")?.state).toBe("idle");
				}
				if (turn === 40) {
					closeDb();
					reconcileAgentSources();
					expect(queue().list().totalPending).toBe(0);
				}
			}
			await deliver("SessionStart", 55, ++produced, { sessionSource: "resume" });
			expect(agent.getSession("one")?.state).toBe("running");
			await deliver("UserPromptSubmit", 56);
			await deliver("Stop", 56);
			expect(queue().list().totalPending).toBe(1);
			if (provider === "claude") {
				await deliver("UserPromptSubmit", 57);
				await deliver("StopFailure", 57);
				expect(queue().list().items[0]?.summary).toBe("Agent turn failed; needs attention");
				expect(agent.getSession("one")?.state).toBe("needs-input");
			}
		} finally {
			listener.stop();
			agent.dispose();
		}
	}, 20_000);
}

test("fresh explicit generation start can reuse a terminal; delayed old generation cannot reclaim it", () => {
	const agent = manager();
	register(agent, "one");
	const stamp = Date.now();
	agent.handleAgentEvent({
		...event("one"),
		rawEvent: "Stop",
		producerTimestamp: stamp,
		timestamp: stamp,
		turnId: "old-turn",
	});
	expect(
		agent.handleAgentEvent({
			...event("one", "active"),
			providerSessionId: "new-provider",
			rawEvent: "SessionStart",
			sessionSource: "startup",
			producerTimestamp: stamp + 1,
			timestamp: stamp + 1,
		})
	).not.toBeNull();
	expect(agent.getSession("one")?.providerSessionId).toBe("new-provider");
	expect(agent.getSession("one")?.managed).toBe(false);
	expect(
		agent.handleAgentEvent({
			...event("one", "active"),
			rawEvent: "SessionStart",
			sessionSource: "resume",
			producerTimestamp: stamp,
			timestamp: stamp + 2,
		})
	).toBeNull();
	expect(
		agent.handleAgentEvent({
			...event("one"),
			timestamp: stamp + 3,
			producerTimestamp: stamp,
			turnId: "old-turn",
		})
	).toBeNull();
	expect(agent.getSession("one")?.providerSessionId).toBe("new-provider");
	agent.dispose();
});

test("newer timed activity recovers a missed prompt; an unknown Stop cannot invent the next turn", () => {
	const agent = manager();
	register(agent, "one");
	const stamp = Date.now();
	const deliver = (alert: AgentEvent["alert"], turnId: string, rawEvent: string, delta: number) =>
		agent.handleAgentEvent({
			...event("one", alert),
			turnId,
			rawEvent,
			producerTimestamp: stamp + delta,
			timestamp: stamp + delta,
		});
	deliver("task-complete", "first", "Stop", 0);
	expect(deliver("task-complete", "unseen", "Stop", 1)).toBeNull();
	expect(deliver("active", "second", "PostToolUse", 2)).not.toBeNull();
	expect(agent.getSession("one")?.state).toBe("running");
	expect(deliver("task-complete", "first", "Stop", 3)).toBeNull();
	expect(deliver("task-complete", "second", "Stop", 4)).not.toBeNull();
	expect(agent.getSession("one")?.state).toBe("idle");
	agent.dispose();
});

test("failure supersedes a handled approval request without claiming task success", () => {
	const agent = manager();
	register(agent, "one");
	agent.handleAgentEvent({ ...event("one", "needs-input"), rawEvent: "PermissionRequest" });
	const input = queue().list().items[0];
	queue().acknowledge({ id: input?.id ?? "", revision: input?.revision ?? 0 });
	agent.handleAgentEvent({ ...event("one", "needs-input"), rawEvent: "StopFailure" });
	expect(queue().list().items[0]?.reasons[0]?.code).toBe("turn-failed");
	expect(queue().list().items[0]?.kind).toBe("agent-input");
	agent.dispose();
});

for (const provider of ["codex", "claude"] as const) {
	test(`${provider}: a direct reply clears the exact manual chat's bound workspace report`, async () => {
		const agent = manager();
		register(agent, "manual");
		register(agent, "sibling");
		getDb().update(agentSessions).set({ managed: false, provider }).run();
		const ctx = { kind: "workspace" as const, projectId, workspaceId, terminalId: "manual" };
		let stamp = Date.now();
		const deliver = (id: string, turnId: string, rawEvent: string, alert: AgentEvent["alert"]) => {
			stamp = Math.max(stamp + 1, Date.now() + 1);
			return agent.handleAgentEvent({
				...event(id, alert),
				agent: provider,
				turnId,
				rawEvent,
				timestamp: stamp,
				producerTimestamp: stamp,
			});
		};
		try {
			deliver("manual", "first", "UserPromptSubmit", "active");
			await setStatus(ctx, { phase: "blocked", needs: "Choose A or B" });
			deliver("manual", "first", "Stop", "task-complete");
			const report = queue().read(workspaceSourceId(workspaceId));
			expect(report?.candidate).not.toBeNull();
			deliver("sibling", "other", "UserPromptSubmit", "active");
			expect(queue().read(workspaceSourceId(workspaceId))?.candidate).not.toBeNull();
			deliver("manual", "second", "UserPromptSubmit", "active");
			expect(queue().list().totalPending).toBe(0);
			closeDb();
			reconcileAgentSources();
			expect(queue().list().totalPending).toBe(0);
			deliver("manual", "second", "Stop", "task-complete");
			expect(queue().list().totalPending).toBe(1);
		} finally {
			agent.dispose();
		}
	});
}

test("working status clears its chat's old turn, rejects replay, and allows the next completion", async () => {
	const agent = manager();
	register(agent, "manual");
	register(agent, "sibling");
	getDb().update(agentSessions).set({ managed: false }).run();
	const ctx = { kind: "workspace" as const, projectId, workspaceId, terminalId: "manual" };
	const before = Date.now() - 10;
	try {
		for (const terminal of ["manual", "sibling"]) {
			getDb()
				.update(agentSessions)
				.set({ lastEventAt: new Date(before - 10) })
				.where(eq(agentSessions.terminalId, terminal))
				.run();
			agent.handleAgentEvent({
				...event(terminal),
				rawEvent: "Stop",
				turnId: "old",
				timestamp: before,
				producerTimestamp: before,
			});
		}
		expect(queue().list().totalPending).toBe(2);
		await setStatus(ctx, { phase: "working" });
		expect(
			queue()
				.list()
				.items.map((item) => item.target.type === "terminal" && item.target.terminalId)
		).toEqual(["sibling"]);
		closeDb();
		reconcileAgentSources();
		expect(queue().list().totalPending).toBe(1);
		const now = Date.now() + 1;
		expect(
			agent.handleAgentEvent({
				...event("manual"),
				rawEvent: "Stop",
				turnId: "old",
				timestamp: now,
				producerTimestamp: now,
			})
		).toBeNull();
		expect(
			agent.handleAgentEvent({
				...event("manual"),
				rawEvent: "Stop",
				turnId: "new",
				timestamp: now + 1,
				producerTimestamp: now + 1,
			})
		).not.toBeNull();
		expect(queue().list().totalPending).toBe(2);
	} finally {
		agent.dispose();
	}
});

test("working status without a valid reporter cannot clear arbitrary chats", async () => {
	const agent = manager();
	register(agent, "manual");
	try {
		agent.handleAgentEvent({ ...event("manual"), rawEvent: "Stop", turnId: "old" });
		await setStatus(
			{ kind: "workspace", projectId, workspaceId, terminalId: "unknown" },
			{ phase: "working" }
		);
		expect(queue().list().totalPending).toBe(1);
		await setStatus({ kind: "workspace", projectId, workspaceId }, { phase: "working" });
		expect(queue().list().totalPending).toBe(1);
	} finally {
		agent.dispose();
	}
});
