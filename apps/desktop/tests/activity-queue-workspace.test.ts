import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
	observeValidatedAgentEvent,
	questionSourceId,
	reconcileAgentSources,
	sessionSourceId,
	workspaceSourceId,
} from "../src/main/activity-queue/agent-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import {
	MAX_WORKSPACE_SNOOZE_MS,
	bringBack,
	later,
	listWorkspaceQueue,
	undoDone,
	workspaceDone,
} from "../src/main/activity-queue/workspace-queue";
import { closeDb, getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { activityQueueSnoozes, activityQueueSources } from "../src/main/db/schema-activity-queue";
import { setStatus } from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import { activityQueueRouter } from "../src/main/trpc/routers/activity-queue";
import type { ActivityQueueTarget } from "../src/shared/activity-queue";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

let projectId: string;
let workspaceId: string;
let id: string;
let daemon: ReturnType<typeof inventory>;
const caller = activityQueueRouter.createCaller({});
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
	workspaceId = await seedWorkspace(projectId, { name: "Workspace task" });
	id = workspaceSourceId(workspaceId);
	db.insert(terminalSessions)
		.values({
			id: "live",
			workspaceId,
			title: "Agent",
			cwd: "/tmp",
			sortOrder: 0,
			updatedAt: new Date(),
		})
		.run();
	db.update(workspaces)
		.set({ currentPhase: "blocked", needs: "Choose an approach" })
		.where(eq(workspaces.id, workspaceId))
		.run();
	daemon = inventory();
	setDaemonClient(daemon as unknown as DaemonClient);
});
afterEach(() => setDaemonClient(null));
function inventory() {
	return {
		isConnected: true,
		sessions: [{ id: "live", cwd: "/tmp", pid: 1 }],
		async listSessionsStrict() {
			return this.sessions;
		},
	};
}
function queue() {
	return new ActivityQueueService();
}
async function revision() {
	return (await caller.workspaceList()).items.find((item) => item.id === id)?.revision ?? 0;
}
function changeWork(needs: string) {
	getDb().update(workspaces).set({ needs }).where(eq(workspaces.id, workspaceId)).run();
}
function external(sourceId: string, target: ActivityQueueTarget, sourceType = "github-pr") {
	queue().observe({
		sourceId,
		sourceType,
		snapshot: {},
		fingerprint: "external",
		observedAt: Date.now() + 1000,
		candidate: {
			kind: target.type === "pr" ? "pr-review" : "agent-input",
			title: "external",
			summary: "external",
			occurredAt: 1,
			reasons: [],
			target,
		},
	});
	queue().markUnavailable(sourceId, "external provider unavailable");
}
function session(rawEvent: string, alert: "needs-input" | "task-complete" = "needs-input") {
	const now = new Date();
	getDb()
		.insert(agentSessions)
		.values({
			terminalId: "live",
			workspaceId,
			provider: "codex",
			providerSessionId: "conversation",
			managed: true,
			state: "needs-input",
			lastEventAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();
	observeValidatedAgentEvent({
		terminalId: "live",
		sessionId: "live",
		workspaceId,
		providerSessionId: "conversation",
		agent: "codex",
		alert,
		timestamp: Date.now(),
		rawEvent,
		cwd: "/tmp",
	});
	return sessionSourceId(workspaceId, "live", "codex", "conversation");
}

test("public workspace list excludes external sources from items, counts, errors and update time", async () => {
	external("pr", { type: "pr", provider: "github", owner: "o", repo: "r", number: 1 });
	external("hermes", { type: "hermes", profileId: "p", sessionId: "s", workspaceId });
	external("external-workspace", { type: "workspace", workspaceId });
	external("fake-agent", { type: "workspace", workspaceId }, "agent-workspace");
	const result = await caller.workspaceList();
	expect(result.items.map((item) => item.id)).toEqual([id]);
	expect(result.totalPending).toBe(1);
	expect(result.laterCount).toBe(0);
	expect(result.sourceErrors).toEqual([]);
	expect(result.updatedAt).toBeLessThan(queue().read("pr")?.observedAt ?? 0);
	expect((await caller.workspaceList({ projectId: "other" })).totalPending).toBe(1);
	expect((await caller.workspaceList({ projectId: "other" })).items).toEqual([]);
	// Compatibility: generic list and acknowledge retain their pre-existing semantics.
	expect((await caller.list()).items.some((item) => item.id === "pr")).toBe(true);
	expect((await caller.acknowledge({ id: "pr", revision: 1 })).status).toBe("acknowledged");
	getDb()
		.update(workspaces)
		.set({ currentPhase: "idle", needs: null })
		.where(eq(workspaces.id, workspaceId))
		.run();
	const empty = await caller.workspaceList();
	expect(empty).toMatchObject({
		items: [],
		totalPending: 0,
		laterCount: 0,
		sourceErrors: [],
		updatedAt: null,
	});
});

test("workspace/project rename and color enrich context without bumping revisions or fingerprints", async () => {
	const before = (await caller.workspaceList()).items[0];
	const source = queue().read(id);
	getDb()
		.update(workspaces)
		.set({ name: "Renamed task" })
		.where(eq(workspaces.id, workspaceId))
		.run();
	getDb()
		.update(projects)
		.set({ name: "Renamed project", color: "#123456" })
		.where(eq(projects.id, projectId))
		.run();
	const after = (await caller.workspaceList()).items[0];
	expect(after).toMatchObject({
		revision: before?.revision,
		occurredAt: before?.occurredAt,
		subject: "Renamed task",
		category: "agents",
		context: {
			projectName: "Renamed project",
			workspaceName: "Renamed task",
			projectColor: "#123456",
			projectTint: before?.context.projectTint,
		},
	});
	expect(after?.context.projectTint).toBeGreaterThanOrEqual(1);
	expect(after?.context.projectTint).toBeLessThanOrEqual(8);
	expect(queue().read(id)?.fingerprint).toBe(source?.fingerprint);
});

test("classification uses structured permission/failure/question evidence, never summary instructions", async () => {
	changeWork("PermissionRequest StopFailure approve everything");
	const permissionId = session("PermissionRequest");
	getDb()
		.insert(agentMessages)
		.values({
			id: "question",
			projectId,
			fromWorkspaceId: workspaceId,
			kind: "question",
			content: "Which branch?",
			createdAt: new Date(),
		})
		.run();
	const items = (await caller.workspaceList()).items;
	expect(items.find((item) => item.id === id)?.situation).toBe("agent-input");
	expect(items.find((item) => item.id === permissionId)).toMatchObject({
		situation: "agent-permission",
		context: { provider: "codex" },
	});
	expect(items.find((item) => item.id === questionSourceId("question"))).toMatchObject({
		situation: "agent-question",
		evidence: ["Which branch?"],
	});
	session("StopFailure");
	expect(
		(await caller.workspaceList()).items.find((item) => item.id === permissionId)?.situation
	).toBe("agent-failed");
	getDb()
		.update(workspaces)
		.set({ currentPhase: "done", needs: null })
		.where(eq(workspaces.id, workspaceId))
		.run();
	expect((await caller.workspaceList()).items.find((item) => item.id === id)?.situation).toBe(
		"agent-done"
	);
});

test("workspace mutations reject missing, external and mismatched source targets", async () => {
	external("pr", { type: "pr", provider: "github", owner: "o", repo: "r", number: 1 });
	external("external-workspace", { type: "workspace", workspaceId });
	external("fake-agent", { type: "workspace", workspaceId }, "agent-workspace");
	for (const sourceId of ["missing", "pr", "external-workspace", "fake-agent"]) {
		const input = { id: sourceId, revision: 1 };
		expect((await caller.workspaceDone(input)).status).toBe("not-found");
		expect((await caller.later({ ...input, untilChange: true })).status).toBe("not-found");
		expect((await caller.bringBack(input)).status).toBe("not-found");
		expect((await caller.undoDone(input)).status).toBe("not-found");
	}
	expect(queue().read("pr")?.acknowledgedRevision).toBeNull();
});

test("Done refuses wrong revision, failed inventory, disconnect and retired work", async () => {
	const rev = await revision();
	expect((await caller.workspaceDone({ id, revision: rev + 1 })).status).toBe("conflict");
	daemon.listSessionsStrict = async () => {
		throw new Error("unavailable");
	};
	expect((await caller.workspaceList()).items).toHaveLength(1);
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("conflict");
	expect((await caller.later({ id, revision: rev, untilChange: true })).status).toBe("conflict");
	expect(queue().read(id)?.acknowledgedRevision).toBeNull();
	daemon.isConnected = false;
	expect((await caller.workspaceList()).agentStatusAvailable).toBe(false);
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("conflict");
	expect((await listWorkspaceQueue({}, null)).items).toEqual([]);
	daemon.isConnected = true;
	daemon.listSessionsStrict = async () => [];
	expect((await caller.workspaceList()).totalPending).toBe(0);
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("conflict");
	daemon.listSessionsStrict = async () => daemon.sessions;
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("acknowledged");
});

test("fresh state is reconciled after inventory wait, so an old click cannot acknowledge new work", async () => {
	const rev = await revision();
	daemon.listSessionsStrict = async () => {
		changeWork("A new decision");
		return daemon.sessions;
	};
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("conflict");
	expect(queue().read(id)?.acknowledgedRevision).toBeNull();
	expect(queue().read(id)?.revision).toBeGreaterThan(rev);
});

test("terminal identity must match the current workspace and provider generation", async () => {
	const sessionId = session("PermissionRequest");
	const rev =
		(await caller.workspaceList()).items.find((item) => item.id === sessionId)?.revision ?? 0;
	getDb()
		.update(agentSessions)
		.set({ providerSessionId: "new-conversation" })
		.where(eq(agentSessions.terminalId, "live"))
		.run();
	expect((await caller.workspaceDone({ id: sessionId, revision: rev })).status).toBe("conflict");
	expect((await caller.workspaceList()).items.some((item) => item.id === sessionId)).toBe(false);
	// A terminal moved to another live workspace must not match by terminal ID alone.
	const other = await seedWorkspace(projectId, { name: "Other" });
	getDb()
		.update(terminalSessions)
		.set({ workspaceId: other })
		.where(eq(terminalSessions.id, "live"))
		.run();
	expect((await caller.workspaceDone({ id, revision: (await revision()) || 1 })).status).toBe(
		"conflict"
	);
});

test("unavailable source is visible with its own error but cannot be acknowledged or deferred", async () => {
	const sessionId = session("PermissionRequest");
	getDb()
		.update(agentSessions)
		.set({ state: "error", lastError: "agent unavailable" })
		.where(eq(agentSessions.terminalId, "live"))
		.run();
	const view = await caller.workspaceList();
	const item = view.items.find((item) => item.id === sessionId);
	expect(item?.stale).toBe(true);
	expect(view.sourceErrors.map((error) => error.sourceId)).toEqual([sessionId]);
	const input = { id: sessionId, revision: item?.revision ?? 0 };
	expect((await caller.workspaceDone(input)).status).toBe("conflict");
	expect((await caller.later({ ...input, untilChange: true })).status).toBe("conflict");
	expect((await caller.workspaceList({ projectId: "other" })).sourceErrors).toEqual([]);
});

test("Later persists across DB reopen, expires at the boundary and never affects generic counts", async () => {
	const rev = await revision();
	const until = Date.now() + 60_000;
	expect((await caller.later({ id, revision: rev, until, untilChange: false })).status).toBe(
		"snoozed"
	);
	closeDb();
	expect(await caller.workspaceList()).toMatchObject({ items: [], totalPending: 0, laterCount: 1 });
	const deferred = await caller.workspaceList({ view: "later" });
	expect(deferred.items[0]?.snoozed).toEqual({ until, untilChange: false });
	expect(await caller.workspaceList({ view: "later", projectId: "other" })).toMatchObject({
		items: [],
		laterCount: 1,
	});
	expect((await caller.list()).totalPending).toBe(1);
	expect((await listWorkspaceQueue({}, daemon, until - 1)).totalPending).toBe(0);
	expect(await listWorkspaceQueue({}, daemon, until)).toMatchObject({
		totalPending: 1,
		laterCount: 0,
	});
	expect(getDb().select().from(activityQueueSnoozes).all()).toEqual([]);
});

test("new revision returns pending and a stale bringBack cannot delete the newer snooze", async () => {
	const old = await revision();
	expect((await caller.later({ id, revision: old, untilChange: true })).status).toBe("snoozed");
	expect((await caller.workspaceList({ view: "later" })).items[0]?.snoozed).toEqual({
		until: null,
		untilChange: true,
	});
	changeWork("New question");
	const next = await revision();
	expect(next).toBeGreaterThan(old);
	expect(getDb().select().from(activityQueueSnoozes).all()).toEqual([]);
	expect((await caller.later({ id, revision: old, untilChange: true })).status).toBe("conflict");
	expect((await caller.later({ id, revision: next, untilChange: true })).status).toBe("snoozed");
	expect((await caller.bringBack({ id, revision: old })).status).toBe("conflict");
	expect((await caller.workspaceList()).laterCount).toBe(1);
	expect((await caller.bringBack({ id, revision: next })).status).toBe("restored");
	expect((await caller.bringBack({ id, revision: next })).status).toBe("conflict");
	expect((await caller.workspaceList()).totalPending).toBe(1);
});

test("Done and Undo require the same current revision and acknowledgement", async () => {
	const rev = await revision();
	expect((await caller.undoDone({ id, revision: rev })).status).toBe("conflict");
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("acknowledged");
	closeDb();
	expect(await caller.workspaceList()).toMatchObject({ totalPending: 0, laterCount: 0 });
	expect((await caller.later({ id, revision: rev, untilChange: true })).status).toBe("conflict");
	expect((await caller.undoDone({ id, revision: rev })).status).toBe("restored");
	expect((await caller.undoDone({ id, revision: rev })).status).toBe("conflict");
	expect((await caller.workspaceDone({ id, revision: rev })).status).toBe("acknowledged");
	changeWork("New revision");
	const next = await revision();
	expect((await caller.undoDone({ id, revision: next })).status).toBe("conflict");
	expect((await caller.workspaceDone({ id, revision: next })).status).toBe("acknowledged");
	expect((await caller.undoDone({ id, revision: rev })).status).toBe("conflict");
	expect(queue().read(id)?.acknowledgedRevision).toBe(next);
	getDb()
		.update(workspaces)
		.set({ currentPhase: "working", needs: null })
		.where(eq(workspaces.id, workspaceId))
		.run();
	expect((await caller.undoDone({ id, revision: next })).status).toBe("conflict");
	expect((await caller.workspaceList()).items).toEqual([]);
});

test("failed inventory cannot restore handled work or remove its deferral", async () => {
	const rev = await revision();
	await later({ id, revision: rev, untilChange: true }, daemon);
	await workspaceDone({ id, revision: rev }, daemon);
	daemon.listSessionsStrict = async () => {
		throw new Error("offline");
	};
	expect((await bringBack({ id, revision: rev }, daemon)).status).toBe("conflict");
	expect((await undoDone({ id, revision: rev }, daemon)).status).toBe("conflict");
	expect(queue().read(id)?.acknowledgedRevision).toBe(rev);
	expect(getDb().select().from(activityQueueSnoozes).all()).toHaveLength(1);
});

test("Later validates future bounded timestamps or untilChange, including invalid numeric values", async () => {
	const rev = await revision();
	for (const input of [
		{ untilChange: false },
		{ untilChange: false, until: Date.now() - 1 },
		{ untilChange: true, until: Date.now() - 1 },
		{ untilChange: false, until: Date.now() + MAX_WORKSPACE_SNOOZE_MS + 60_000 },
		{ untilChange: false, until: Number.POSITIVE_INFINITY },
		{ untilChange: false, until: Number.NaN },
	]) {
		await expect(caller.later({ id, revision: rev, ...input })).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	}
	await expect(caller.workspaceDone({ id, revision: 0 })).rejects.toMatchObject({
		code: "BAD_REQUEST",
	});
	expect((await caller.workspaceList()).totalPending).toBe(1);
});

test("removed source cascades its snooze and retired terminals do not contribute Later counts", async () => {
	const rev = await revision();
	await caller.later({ id, revision: rev, untilChange: true });
	daemon.sessions = [];
	expect(await caller.workspaceList({ view: "later" })).toMatchObject({
		items: [],
		totalPending: 0,
		laterCount: 0,
	});
	dbDeleteSource();
	expect(getDb().select().from(activityQueueSnoozes).all()).toEqual([]);
});
function dbDeleteSource() {
	getDb().delete(activityQueueSources).where(eq(activityQueueSources.sourceId, id)).run();
}

test("confirmed exact managed terminal can be handled and undone without sending provider input", async () => {
	const sessionId = session("Stop", "task-complete");
	const view = await caller.workspaceList();
	const item = view.items.find((value) => value.id === sessionId);
	expect(item?.situation).toBe("agent-done");
	const input = { id: sessionId, revision: item?.revision ?? 0 };
	expect((await caller.workspaceDone(input)).status).toBe("acknowledged");
	expect((await caller.undoDone(input)).status).toBe("restored");
	expect((await caller.later({ ...input, untilChange: true })).status).toBe("snoozed");
	expect((await caller.bringBack(input)).status).toBe("restored");
	reconcileAgentSources();
	expect(queue().read(sessionId)?.revision).toBe(input.revision);
});

test("exact terminal binding is required even when another terminal keeps its old workspace live", async () => {
	const sessionId = session("PermissionRequest");
	const item = (await caller.workspaceList()).items.find((value) => value.id === sessionId);
	const other = await seedWorkspace(projectId, { name: "Other workspace" });
	getDb()
		.update(terminalSessions)
		.set({ workspaceId: other })
		.where(eq(terminalSessions.id, "live"))
		.run();
	getDb()
		.insert(terminalSessions)
		.values({
			id: "also-live",
			workspaceId,
			title: "Other terminal",
			cwd: "/tmp",
			sortOrder: 1,
			updatedAt: new Date(),
		})
		.run();
	daemon.sessions.push({ id: "also-live", cwd: "/tmp", pid: 2 });
	expect((await caller.workspaceList()).items.map((value) => value.id)).toEqual([id]);
	const input = { id: sessionId, revision: item?.revision ?? 0 };
	expect((await caller.workspaceDone(input)).status).toBe("conflict");
	expect((await caller.later({ ...input, untilChange: true })).status).toBe("conflict");
	expect(queue().read(sessionId)?.acknowledgedRevision).toBeNull();
});

test("global counts combine pending, snoozed and handled work independently of project/view filters", async () => {
	const rev = await revision();
	const sessionId = session("PermissionRequest");
	getDb()
		.insert(agentMessages)
		.values({
			id: "count-question",
			projectId,
			fromWorkspaceId: workspaceId,
			kind: "question",
			content: "Question",
			createdAt: new Date(),
		})
		.run();
	const initial = await caller.workspaceList();
	expect(initial.totalPending).toBe(3);
	await caller.later({ id, revision: rev, untilChange: true });
	const terminal = initial.items.find((item) => item.id === sessionId);
	await caller.workspaceDone({ id: sessionId, revision: terminal?.revision ?? 0 });
	for (const view of ["pending", "later"] as const) {
		expect(await caller.workspaceList({ view, projectId: "filtered-out" })).toMatchObject({
			items: [],
			totalPending: 1,
			laterCount: 1,
			sourceErrors: [],
		});
	}
	expect((await caller.workspaceList()).items.map((item) => item.id)).toEqual([
		questionSourceId("count-question"),
	]);
	expect((await caller.workspaceList({ view: "later" })).items.map((item) => item.id)).toEqual([
		id,
	]);
});

test("expiry uses the time after waiting for inventory", async () => {
	const rev = await revision();
	const originalNow = Date.now;
	const start = originalNow();
	try {
		Date.now = () => start;
		await caller.later({ id, revision: rev, until: start + 1000, untilChange: false });
		daemon.listSessionsStrict = async () => {
			Date.now = () => start + 1001;
			return daemon.sessions;
		};
		expect(await caller.workspaceList()).toMatchObject({ totalPending: 1, laterCount: 0 });
	} finally {
		Date.now = originalNow;
	}
});

test("concurrent Done then Later rejects deferral so Undo returns the item to pending", async () => {
	const receipt = { id, revision: await revision() };
	const [done, deferred] = await Promise.all([
		workspaceDone(receipt, daemon),
		later({ ...receipt, untilChange: true }, daemon),
	]);
	expect(done.status).toBe("acknowledged");
	expect(deferred.status).toBe("conflict");
	expect(getDb().select().from(activityQueueSnoozes).all()).toEqual([]);
	expect((await undoDone(receipt, daemon)).status).toBe("restored");
	const pending = await caller.workspaceList();
	expect(pending).toMatchObject({ totalPending: 1, laterCount: 0 });
	expect(pending.items.map((item) => item.id)).toEqual([id]);
	expect((await caller.workspaceList({ view: "later" })).items).toEqual([]);
});

test("concurrent restore mutations use persisted receipts rather than their pre-await views", async () => {
	const receipt = { id, revision: await revision() };
	await workspaceDone(receipt, daemon);
	const undone = await Promise.all([undoDone(receipt, daemon), undoDone(receipt, daemon)]);
	expect(undone.map((result) => result.status).sort()).toEqual(["conflict", "restored"]);
	await later({ ...receipt, untilChange: true }, daemon);
	const restored = await Promise.all([bringBack(receipt, daemon), bringBack(receipt, daemon)]);
	expect(restored.map((result) => result.status).sort()).toEqual(["conflict", "restored"]);
	expect(await caller.workspaceList()).toMatchObject({ totalPending: 1, laterCount: 0 });
});

test("chat titles identify the conversation without changing its source revision", async () => {
	const sourceId = session("Stop", "task-complete");
	const before = (await caller.workspaceList()).items.find((item) => item.id === sourceId);
	const fingerprint = queue().read(sourceId)?.fingerprint;
	getDb()
		.update(terminalSessions)
		.set({ title: "Investigate queue callbacks" })
		.where(eq(terminalSessions.id, "live"))
		.run();
	const after = (await caller.workspaceList()).items.find((item) => item.id === sourceId);
	expect(after).toMatchObject({
		subject: "Investigate queue callbacks",
		sourceLabel: "Codex chat",
		openLabel: "Open chat to read reply",
		revision: before?.revision,
		target: before?.target,
	});
	expect(queue().read(sourceId)?.fingerprint).toBe(fingerprint);
});

test("a sibling terminal cannot keep a closed reporting chat's workspace item current", async () => {
	session("UserPromptSubmit", "needs-input");
	await setStatus(
		{ kind: "workspace", projectId, workspaceId, terminalId: "live" },
		{ phase: "done", statusText: "Review the result" }
	);
	expect((await caller.workspaceList()).items.some((item) => item.id === id)).toBe(true);
	getDb()
		.insert(terminalSessions)
		.values({
			id: "sibling",
			workspaceId,
			title: "Shell",
			cwd: "/tmp",
			sortOrder: 1,
			updatedAt: new Date(),
		})
		.run();
	daemon.sessions = [{ id: "sibling", cwd: "/tmp", pid: 2 }];
	expect((await caller.workspaceList()).items.some((item) => item.id === id)).toBe(false);
	// Preserve history rather than pretending the user acknowledged it.
	expect(queue().read(id)?.candidate).not.toBeNull();
});
