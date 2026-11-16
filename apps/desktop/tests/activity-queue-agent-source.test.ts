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
import { setStatus } from "../src/main/services/workspace-service";
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
			provider: "codex",
			providerSessionId: "one-provider",
		},
	]);
	agent.dispose();
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
