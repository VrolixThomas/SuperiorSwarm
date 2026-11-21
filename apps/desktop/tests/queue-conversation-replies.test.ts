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
