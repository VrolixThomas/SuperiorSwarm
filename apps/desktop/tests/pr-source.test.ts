import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { observePRActivity, prSourceId } from "../src/main/activity-queue/pr-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import type { CachedPR } from "../src/shared/review-types";
import { setupTestDb } from "./helpers/db";
beforeAll(setupTestDb);
beforeEach(() => {
	getDb().delete(activityQueueSources).run();
});
const pr: CachedPR = {
	provider: "github",
	identifier: "o/r#1",
	number: 1,
	title: "PR",
	state: "open",
	sourceBranch: "feat",
	targetBranch: "main",
	author: { login: "a", avatarUrl: "" },
	reviewers: [],
	ciStatus: null,
	commentCount: 0,
	changedFiles: 0,
	additions: 0,
	deletions: 0,
	updatedAt: "",
	repoOwner: "o",
	repoName: "r",
	projectId: "",
	role: "reviewer",
	headCommitSha: "a",
};
const facts = {
	state: "open" as const,
	headSha: "a",
	isDraft: false,
	reviewRequested: true,
	reviewToken: "r0",
	commentToken: "c0",
};
test("baseline persists; handled survives restart and duplicate polls; new activity returns", () => {
	let queue = new ActivityQueueService();
	observePRActivity(pr, facts, [], 1, queue);
	const item = queue.list().items[0];
	if (!item) throw new Error("Expected queue item");
	queue.acknowledge({ id: item.id, revision: item.revision });
	queue = new ActivityQueueService();
	observePRActivity(pr, facts, [], 2, queue);
	expect(queue.list().totalPending).toBe(0);
	observePRActivity(pr, { ...facts, headSha: "b" }, [], 3, queue);
	expect(queue.list().totalPending).toBe(1);
	expect(queue.list().items[0]?.reasons.map((r) => r.label)).toContain("New commits");
	expect(queue.acknowledge({ id: item.id, revision: item.revision }).status).toBe("conflict");
});
test("first reviewed-only PR baselines silently, and each material field produces an update", () => {
	const queue = new ActivityQueueService();
	const baseline = { ...facts, reviewRequested: false };
	observePRActivity(pr, baseline, [], 1, queue);
	expect(queue.list().totalPending).toBe(0);
	observePRActivity(pr, { ...baseline, commentToken: "c1", reviewToken: "r1" }, [], 2, queue);
	expect(queue.list().items[0]?.kind).toBe("pr-update");
	expect(queue.list().items[0]?.reasons.map((r) => r.label)).toEqual([
		"Comment activity changed",
		"Review activity changed",
	]);
});
test("loss and first acquisition of enrichment never resurrect handled request", () => {
	const queue = new ActivityQueueService();
	observePRActivity(pr, { state: "open", isDraft: false, reviewRequested: true }, [], 1, queue);
	const item = queue.list().items[0];
	if (!item) throw new Error("Expected queue item");
	queue.acknowledge({ id: item.id, revision: item.revision });
	observePRActivity(pr, {}, [], 2, queue, "offline");
	expect(queue.list().totalPending).toBe(0);
	expect(queue.list({ includeAcknowledged: true }).items[0]?.stale).toBe(true);
	observePRActivity(pr, facts, [], 3, queue);
	expect(queue.list().totalPending).toBe(0);
	expect(queue.read(item.id)?.snapshot).toMatchObject({ headSha: "a", reviewRequested: true });
});
test("same number in distinct repositories/providers has independent receipts and closure", () => {
	const queue = new ActivityQueueService();
	const second = { ...pr, identifier: "o/other#1", repoName: "other" };
	const third = { ...pr, provider: "bitbucket" as const };
	for (const value of [pr, second, third]) observePRActivity(value, facts, [], 1, queue);
	expect(queue.list().totalPending).toBe(3);
	observePRActivity(pr, { state: "merged" }, [], 2, queue);
	expect(queue.list().totalPending).toBe(2);
	expect(queue.read(prSourceId(pr))?.candidate).toBeNull();
	observePRActivity(second, {}, [], 2, queue, "timeout");
	expect(queue.list().totalPending).toBe(2);
});
test("local ready draft uses precise label and status removal resolves without editing provenance", () => {
	const queue = new ActivityQueueService();
	observePRActivity(pr, { ...facts, reviewRequested: false }, ["manual"], 1, queue);
	expect(queue.list().items[0]?.summary).toBe("Review draft ready");
	observePRActivity(pr, { ...facts, reviewRequested: false }, [], 2, queue);
	expect(queue.list().totalPending).toBe(0);
});
test("new activity after Handled reports current changes rather than handled update reasons", () => {
	const queue = new ActivityQueueService();
	observePRActivity(pr, { ...facts, reviewRequested: false }, [], 1, queue);
	observePRActivity(pr, { ...facts, reviewRequested: false, headSha: "b" }, [], 2, queue);
	const item = queue.list().items[0];
	if (!item) throw new Error("Expected update");
	queue.acknowledge({ id: item.id, revision: item.revision });
	observePRActivity(
		pr,
		{ ...facts, reviewRequested: false, headSha: "b", commentToken: "c1" },
		[],
		3,
		queue
	);
	expect(queue.list().items[0]?.reasons.map((r) => r.label)).toEqual(["Comment activity changed"]);
});
