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
const actions = await import("../src/main/activity-queue/pr-actions");
beforeAll(setupTestDb);
beforeEach(() => {
	getDb().delete(sessionState).run();
	head = "head";
	eligible = true;
	calls = 0;
	uncertain = false;
	current = true;
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
test("undo and close reservation never post", async () => {
	await prepare("undo");
	actions.cancelQueuePRReview("undo");
	expect((await actions.dispatchQueuePRReview("undo")).status).toBe("cancelled");
	await prepare("close");
	expect(calls).toBe(0);
});
test("main enforces 5-second window", async () => {
	await prepare("early");
	await expect(actions.dispatchQueuePRReview("early")).rejects.toThrow("undo period");
	expect(calls).toBe(0);
});
test("changed head and evidence refuse dispatch", async () => {
	await prepare("head");
	elapsed("head");
	head = "other";
	expect((await actions.dispatchQueuePRReview("head")).status).toBe("rejected");
	expect(calls).toBe(0);
	head = "head";
	await prepare("ci");
	elapsed("ci");
	eligible = false;
	expect((await actions.dispatchQueuePRReview("ci")).status).toBe("rejected");
	expect(calls).toBe(0);
});
test("duplicates and uncertain outcomes never post twice", async () => {
	await prepare("once");
	elapsed("once");
	uncertain = true;
	await Promise.all([actions.dispatchQueuePRReview("once"), actions.dispatchQueuePRReview("once")]);
	expect(calls).toBe(1);
	await actions.dispatchQueuePRReview("once");
	expect(calls).toBe(1);
});
test("recovered attempted receipt never dispatches", async () => {
	await prepare("restart");
	const receipt = actions.queuePRReviewReceipt("restart")!;
	getDb()
		.update(sessionState)
		.set({ value: JSON.stringify({ ...receipt, status: "attempted", notBefore: 0 }) })
		.run();
	expect((await actions.dispatchQueuePRReview("restart")).status).toBe("attempted");
	expect(calls).toBe(0);
});
test("account change during undo retains attention", async () => {
	await prepare("account");
	elapsed("account");
	current = false;
	expect((await actions.dispatchQueuePRReview("account")).status).toBe("rejected");
	expect(calls).toBe(0);
});
test("concurrent distinct request IDs reserve an occurrence only once", async () => {
	const outcomes = await Promise.allSettled([prepare("first-id"), prepare("second-id")]);
	expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
});
test("uncertain attempt blocks a fresh request ID for same occurrence", async () => {
	await prepare("uncertain-id");
	elapsed("uncertain-id");
	uncertain = true;
	await actions.dispatchQueuePRReview("uncertain-id");
	await expect(prepare("new-id")).rejects.toThrow("unknown outcome");
	expect(calls).toBe(1);
});
test("successful approval acknowledges only its exact queue occurrence", async () => {
	const { ActivityQueueService } = await import("../src/main/activity-queue/service");
	const queue = new ActivityQueueService();
	queue.observe({
		sourceId: "review",
		sourceType: "pr",
		fingerprint: "one",
		observedAt: Date.now(),
		snapshot: {},
		candidate: {
			kind: "pr-review",
			title: "Review",
			summary: "Review requested",
			occurredAt: Date.now(),
			reasons: [],
			target: {
				type: "pr",
				provider: "github",
				owner: "owner",
				repo: "repo",
				number: 1,
				accountId: "me",
				host: "github.com",
			},
		},
	});
	await prepare("success");
	elapsed("success");
	expect((await actions.dispatchQueuePRReview("success")).status).toBe("submitted");
	expect(calls).toBe(1);
	expect(queue.read("review")?.acknowledgedRevision).toBe(1);
});
