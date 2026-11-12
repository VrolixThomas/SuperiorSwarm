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
import { activityQueueRouter } from "../src/main/trpc/routers/activity-queue";
import { workspacesRouter } from "../src/main/trpc/routers/workspaces";
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
	const api = activityQueueRouter.createCaller({});
	const ctx = { kind: "workspace" as const, projectId, workspaceId };
	await setStatus(ctx, { phase: "blocked", needs: "First" });
	const displayed = (await api.list()).items[0];
	await setStatus(ctx, { phase: "blocked", needs: "Second" });
	expect(
		(await api.acknowledge({ id: displayed?.id ?? "", revision: displayed?.revision ?? 0 })).status
	).toBe("conflict");
	expect((await api.list()).totalPending).toBe(1);
	await setStatus(ctx, { phase: "working" });
	const agent = manager();
	register(agent, "one");
	agent.handleAgentEvent({ ...event("one", "needs-input"), workspaceId: "" });
	expect((await api.list()).items[0]?.kind).toBe("agent-input");
	agent.dispose();
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
