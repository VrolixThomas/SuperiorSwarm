import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { getDb } from "../src/main/db";
import { sessionState } from "../src/main/db/schema";
import { setupTestDb } from "./helpers/db";
let head = "head";
let eligible = true;
let calls = 0;
let uncertain = false;
let current = true;
let failCleanup = true;
let cleanupCalls = 0;
const item = {
	id: "review",
	revision: 1,
	kind: "pr-review",
	target: {
		type: "pr",
		provider: "github",
		owner: "owner",
		repo: "repo",
		number: 1,
		accountId: "me",
		host: "github.com",
	},
};
mock.module("../src/main/activity-queue/queue-view", () => ({
	currentExternalQueueItem: () => (current ? item : null),
}));
mock.module("../src/main/activity-queue/pr-scope", () => ({ isPRQueueItemCurrent: () => current }));
mock.module("../src/main/activity-queue/pr-eligibility", () => ({
	fetchQueuePRReviewEvidence: async () => ({ headSha: head, eligible, evidence: [], reasons: [] }),
}));
mock.module("../src/main/providers/git-provider", () => ({
	getGitProvider: () => ({ getPRState: async () => ({ headSha: head, state: "open" }) }),
}));
mock.module("../src/main/github/auth", () => ({
	githubFetch: async () => {
		calls++;
		if (uncertain) throw new Error("transport");
		return new Response("{}", { status: 200 });
	},
}));
mock.module("../src/main/activity-queue/service", () => ({
	getActivityQueueService: () => ({
		acknowledge: () => {
			cleanupCalls++;
			if (failCleanup) throw Error("synthetic receipt DB failure after provider accepted");
		},
	}),
}));
const actions = await import("../src/main/activity-queue/pr-actions");
beforeAll(setupTestDb);
beforeEach(() => {
	getDb().delete(sessionState).run();
	head = "head";
	eligible = true;
	calls = 0;
	uncertain = false;
	current = true;
	failCleanup = true;
	cleanupCalls = 0;
});
async function prepare(id: string) {
	return actions.prepareQueuePRReview({
		id: "review",
		revision: 1,
		requestId: id,
		headSha: "head",
		approveAnyway: false,
	});
}
function elapsed(id: string) {
	const receipt = actions.queuePRReviewReceipt(id)!;
	getDb()
		.update(sessionState)
		.set({ value: JSON.stringify({ ...receipt, notBefore: Date.now() - 1 }) })
		.run();
}
test("successful post keeps submitted receipt if local cleanup fails", async () => {
	await prepare("accepted-one");
	elapsed("accepted-one");
	const first = await actions.dispatchQueuePRReview("accepted-one");
	expect(first.status).toBe("submitted");
	await expect(prepare("accepted-two")).rejects.toThrow("reservation");
	failCleanup = false;
	expect((await actions.dispatchQueuePRReview("accepted-one")).detail).toBe("Review submitted.");
	expect(cleanupCalls).toBe(2);
	expect(actions.queuePRReviewReceipt("accepted-one")?.status).toBe("submitted");
	expect(calls).toBe(1);
});
