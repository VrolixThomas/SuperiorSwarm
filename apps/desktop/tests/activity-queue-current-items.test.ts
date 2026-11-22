import { beforeAll, beforeEach, expect, test } from "bun:test";
import { listCurrentActivityQueue } from "../src/main/activity-queue/current-items";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { projects, terminalSessions, workspaces } from "../src/main/db/schema";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import type { ActivityQueueTarget } from "../src/shared/activity-queue";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

let active: string;
let retired: string;
beforeAll(setupTestDb);
beforeEach(async () => {
	const db = getDb();
	db.delete(activityQueueSources).run();
	db.delete(terminalSessions).run();
	db.delete(workspaces).run();
	db.delete(projects).run();
	const projectId = await seedProject();
	active = await seedWorkspace(projectId, { name: "Active work" });
	retired = await seedWorkspace(projectId, { name: "Old work" });
	for (const [id, workspaceId] of [
		["live", active],
		["dead", retired],
	] as const)
		db.insert(terminalSessions)
			.values({ id, workspaceId, cwd: "/tmp", title: id, sortOrder: 0, updatedAt: new Date() })
			.run();
	for (const [id, target] of [
		["active", { type: "workspace", workspaceId: active }],
		["retired", { type: "workspace", workspaceId: retired }],
		["old-question", { type: "workspace", workspaceId: retired }],
		[
			"dead-session",
			{
				type: "terminal",
				workspaceId: retired,
				terminalId: "dead",
				provider: "codex",
				providerSessionId: "old",
			},
		],
		["pr", { type: "pr", provider: "github", owner: "owner", repo: "repo", number: 1 }],
	] satisfies [string, ActivityQueueTarget][])
		new ActivityQueueService().observe({
			sourceId: id,
			sourceType: "test",
			snapshot: {},
			fingerprint: "initial",
			observedAt: 1,
			candidate: {
				kind: target.type === "pr" ? "pr-review" : "agent-input",
				title: id,
				summary: id,
				reasons: [],
				occurredAt: 1,
				target,
			},
		});
});
function inventory() {
	return {
		isConnected: true,
		sessions: [{ id: "live", cwd: "/tmp", pid: 1 }],
		async listSessionsStrict() {
			return this.sessions;
		},
	};
}
test("old reports and questions without live terminals are hidden without deleting their data", async () => {
	const daemon = inventory();
	const result = await listCurrentActivityQueue({}, daemon);
	expect(result.items.map((item) => item.id)).toEqual(["active", "pr"]);
	expect(result.totalPending).toBe(2);
	expect(result.agentStatusAvailable).toBe(true);
	expect(new ActivityQueueService().read("old-question")?.candidate).not.toBeNull();
	// A confirmed empty inventory is different from a failed inventory query.
	daemon.sessions = [];
	expect((await listCurrentActivityQueue({}, daemon)).items.map((item) => item.id)).toEqual(["pr"]);
});
test("disconnects retain the last confirmed list; cold unavailable state never advertises historical work", async () => {
	const daemon = inventory();
	await listCurrentActivityQueue({}, daemon);
	daemon.isConnected = false;
	const offline = await listCurrentActivityQueue({}, daemon);
	expect(offline.items.map((item) => item.id)).toEqual(["active", "pr"]);
	expect(offline.agentStatusAvailable).toBe(false);
	const unknown = await listCurrentActivityQueue({}, null);
	expect(unknown.items.map((item) => item.id)).toEqual(["pr"]);
	expect(unknown.agentStatusAvailable).toBe(false);
});
test("failed refresh is not removal, and returning sessions retain handled receipts", async () => {
	const daemon = inventory();
	await listCurrentActivityQueue({}, daemon);
	daemon.listSessionsStrict = async () => {
		throw new Error("offline");
	};
	expect((await listCurrentActivityQueue({}, daemon)).totalPending).toBe(2);
	const queue = new ActivityQueueService();
	queue.acknowledge({ id: "active", revision: 1 });
	daemon.listSessionsStrict = async () => [{ id: "live", cwd: "/tmp", pid: 1 }];
	expect((await listCurrentActivityQueue({}, daemon)).totalPending).toBe(1);
	expect(
		(await listCurrentActivityQueue({ includeAcknowledged: true }, daemon)).items.find(
			(item) => item.id === "active"
		)?.acknowledged
	).toBe(true);
});
