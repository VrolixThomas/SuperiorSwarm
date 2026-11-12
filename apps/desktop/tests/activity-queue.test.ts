import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { closeDb, getDb } from "../src/main/db";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import type { ActivityQueueObservation } from "../src/shared/activity-queue";
import { setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
beforeEach(() => {
	getDb().delete(activityQueueSources).run();
});
function observation(fingerprint = "A", observedAt = 1): ActivityQueueObservation {
	return {
		sourceId: "test",
		sourceType: "test",
		snapshot: { version: 1, fingerprint },
		fingerprint,
		observedAt,
		candidate: {
			kind: "agent-input",
			title: "Input",
			summary: "Question",
			occurredAt: observedAt,
			reasons: [{ code: "question", label: "Question" }],
			target: { type: "workspace", workspaceId: "workspace" },
		},
	};
}
test("durable snapshot and handled state survive service recreation; duplicates preserve occurrence", () => {
	let queue = new ActivityQueueService();
	queue.observe(observation());
	expect(queue.acknowledge({ id: "test", revision: 1 }).status).toBe("acknowledged");
	closeDb();
	queue = new ActivityQueueService();
	queue.observe(observation("A", 2));
	expect(queue.read("test")?.snapshot).toEqual({ version: 1, fingerprint: "A" });
	expect(queue.list().totalPending).toBe(0);
	expect(queue.list({ includeAcknowledged: true }).items[0]?.occurredAt).toBe(1);
});
test("A to B to A stays monotonic and old acknowledgment cannot hide newer activity", () => {
	const queue = new ActivityQueueService();
	queue.observe(observation());
	queue.observe(observation("B", 2));
	queue.observe(observation("A", 3));
	expect(queue.read("test")?.revision).toBe(3);
	expect(queue.acknowledge({ id: "test", revision: 1 }).status).toBe("conflict");
	expect(queue.list().totalPending).toBe(1);
});
test("resolved then recurring same signal is a new occurrence; stale observation ignored", () => {
	const queue = new ActivityQueueService();
	queue.observe(observation());
	queue.resolve("test", 2);
	expect(queue.list().totalPending).toBe(0);
	queue.observe(observation("A", 3));
	expect(queue.read("test")?.revision).toBe(3);
	queue.observe(observation("B", 1));
	expect(queue.read("test")?.fingerprint).toBe("A");
});
test("unavailable preserves baseline and pending; global count ignores filters", () => {
	const queue = new ActivityQueueService();
	queue.observe(observation());
	queue.markUnavailable("test", "offline");
	expect(queue.list().items[0]?.stale).toBe(true);
	expect(queue.list({ projectId: "other" }).totalPending).toBe(1);
	expect(queue.list({ projectId: "other" }).items).toHaveLength(0);
	queue.observe(observation("A", 2));
	expect(queue.list().sourceErrors).toHaveLength(0);
	expect(queue.read("test")?.revision).toBe(1);
});
