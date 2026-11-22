import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { draftComments, reviewDrafts, sessionState } from "../src/main/db/schema";
import type { QueuePRPublication } from "../src/shared/queue-pr-publication";
import { setupTestDb } from "./helpers/db";
let head = "head";
let current = true;
let uncertain = false;
let ackFails = false;
let posts: unknown[] = [];
let stateResponder: (() => Promise<{ headSha: string; state: string }>) | undefined;
let inlineHook: (() => void) | undefined;
let stateHook: (() => void) | undefined;
const item = {
	id: "queue",
	revision: 1,
	kind: "pr-review",
	target: {
		type: "pr",
		provider: "github",
		owner: "owner",
		repo: "repo",
		number: 7,
		accountId: "me",
		host: "github.com",
	},
};
mock.module("../src/main/activity-queue/queue-view", () => ({
	currentExternalQueueItem: () => (current ? item : null),
}));
mock.module("../src/main/activity-queue/pr-scope", () => ({ isPRQueueItemCurrent: () => current }));
mock.module("../src/main/activity-queue/service", () => ({
	getActivityQueueService: () => ({
		acknowledge: () => {
			if (ackFails) throw Error("local ack failed");
		},
	}),
}));
mock.module("../src/main/activity-queue/pr-eligibility", () => ({
	fetchQueuePRReviewEvidence: async () => ({ headSha: head, eligible: true }),
}));
mock.module("../src/main/github/auth", () => ({
	githubFetch: async (_path: string, input: { body: string }) => {
		posts.push(JSON.parse(input.body));
		if (uncertain) throw Error("unknown network outcome");
		return Response.json({});
	},
}));
mock.module("../src/main/providers/git-provider", () => ({
	getGitProvider: () => ({
		getPRState: async () => {
			stateHook?.();
			if (stateResponder) return stateResponder();
			return { headSha: head, state: "open" };
		},
		getPRFiles: async () => [{ path: "file.ts", status: "modified" }],
		getReviewThreads: async () => [{ nodeId: "thread", isResolved: false }],
		replyToComment: async (input: unknown) => {
			posts.push(input);
			return { id: "reply" };
		},
		resolveComment: async (input: unknown) => {
			posts.push(input);
		},
		createInlineComment: async (input: unknown) => {
			posts.push(input);
			inlineHook?.();
			return { id: "comment" };
		},
	}),
}));
let pushes = 0;
let solveSignature = "snapshot";
let failSolvePost = false;
mock.module("../src/main/activity-queue/solve-publication", () => ({
	assertSolveMutationCurrent: (
		_snapshot: unknown,
		_method: string,
		input: { queueReplyId?: string }
	) => {
		if (input.queueReplyId !== "reply") throw Error("Missing exact reply receipt");
	},
	solvePublicationSnapshot: () => ({
		signature: solveSignature,
		head: "local-head",
		context: { accountId: "me", host: "github.com", prCtx: { provider: "github" } },
		comments: [{ id: "comment", threadId: "thread", platformCommentId: "queue-feedback:thread:x" }],
		replies: [{ prCommentId: "comment", status: "approved", body: "Approved reply" }],
	}),
}));
const publishSolve = async (
	_id: string,
	guard: {
		beforePush: () => Promise<void>;
		afterPush: () => void;
		provider: { replyToComment: (input: unknown) => Promise<unknown> };
	}
) => {
	await guard.beforePush();
	pushes++;
	head = "local-head";
	guard.afterPush();
	if (failSolvePost)
		return { pushed: true, repliesPosted: 0, threadsResolved: 0, errors: ["uncertain post"] };
	await guard.provider.replyToComment({
		owner: "owner",
		repo: "repo",
		prNumber: 7,
		commentId: "thread",
		body: "Approved reply",
		queueReplyId: "reply",
	});
	return { pushed: true, repliesPosted: 1, threadsResolved: 0, errors: [] };
};
mock.module("../src/main/ai-review/solve-publisher", () => ({
	publishSolve,
	publishGroup: publishSolve,
}));
const pub = await import("../src/main/activity-queue/pr-publication");
const approvals = await import("../src/main/activity-queue/pr-actions");
beforeAll(setupTestDb);
beforeEach(() => {
	getDb().delete(sessionState).run();
	getDb().delete(reviewDrafts).run();
	head = "head";
	current = true;
	uncertain = false;
	ackFails = false;
	posts = [];
	stateHook = undefined;
	inlineHook = undefined;
	stateResponder = undefined;
	pushes = 0;
	solveSignature = "snapshot";
	failSolvePost = false;
});
const review: QueuePRPublication = { kind: "review", verdict: "COMMENT", body: "Reviewed" };
const prepare = (requestId: string, operation: QueuePRPublication = review) =>
	pub.prepareQueuePRPublication({
		origin: { id: "queue", revision: 1 },
		requestId,
		headSha: "head",
		operation,
	});
function elapsed(id: string) {
	const key = `queue-pr-publication:${id}`;
	const row = getDb().select().from(sessionState).where(eq(sessionState.key, key)).get()!;
	getDb()
		.update(sessionState)
		.set({ value: JSON.stringify({ ...JSON.parse(row.value), notBefore: Date.now() - 1 }) })
		.where(eq(sessionState.key, key))
		.run();
}
function draft() {
	const now = new Date();
	getDb()
		.insert(reviewDrafts)
		.values({
			id: "draft",
			prProvider: "github",
			prIdentifier: "owner/repo#7",
			prTitle: "PR",
			prAuthor: "author",
			sourceBranch: "branch",
			targetBranch: "main",
			status: "ready",
			commitSha: "head",
			summaryMarkdown: "saved summary",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(draftComments)
		.values({
			id: "comment",
			reviewDraftId: "draft",
			filePath: "file.ts",
			lineNumber: 1,
			body: "saved comment",
			status: "user-pending",
			createdAt: now,
		})
		.run();
}
test("five-second Undo and cancel prevent every external post", async () => {
	await prepare("one");
	await expect(pub.dispatchQueuePRPublication("one")).rejects.toThrow("undo period");
	pub.cancelQueuePRPublication("one");
	elapsed("one");
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("cancelled");
	expect(posts).toEqual([]);
});
test("account or head change during delay rejects without a post", async () => {
	await prepare("one");
	elapsed("one");
	head = "new";
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("rejected");
	expect(posts).toEqual([]);
	head = "head";
	await prepare("two");
	elapsed("two");
	current = false;
	expect((await pub.dispatchQueuePRPublication("two")).status).toBe("rejected");
	expect(posts).toEqual([]);
});
test("cancel during async final validation wins over dispatch", async () => {
	await prepare("one");
	elapsed("one");
	stateHook = () => pub.cancelQueuePRPublication("one");
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("cancelled");
	expect(posts).toEqual([]);
});
test("duplicate concurrent dispatch publishes exactly once, pinned to viewed head", async () => {
	await prepare("one");
	elapsed("one");
	await Promise.all([pub.dispatchQueuePRPublication("one"), pub.dispatchQueuePRPublication("one")]);
	expect(posts).toEqual([{ event: "COMMENT", body: "Reviewed", commit_id: "head" }]);
	await pub.dispatchQueuePRPublication("one");
	expect(posts).toHaveLength(1);
});
test("different IDs cannot reserve same occurrence concurrently", async () => {
	const results = await Promise.allSettled([prepare("one"), prepare("two")]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
test("unknown outcome blocks publication and direct Queue approval", async () => {
	await prepare("one");
	elapsed("one");
	uncertain = true;
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("attempted");
	await expect(prepare("two", { kind: "review", verdict: "APPROVE", body: "" })).rejects.toThrow(
		"unknown outcome"
	);
	await expect(
		approvals.prepareQueuePRReview({
			id: "queue",
			revision: 1,
			requestId: "direct",
			headSha: "head",
			approveAnyway: false,
		})
	).rejects.toThrow("unknown outcome");
	expect(posts).toHaveLength(1);
});
test("submitted status survives queue cleanup failure", async () => {
	await prepare("one");
	elapsed("one");
	ackFails = true;
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("submitted");
	await expect(prepare("two")).rejects.toThrow("reservation");
	expect(posts).toHaveLength(1);
});
test("draft edits during delay reject while retaining all local text", async () => {
	draft();
	await prepare("one", {
		kind: "draft",
		draftId: "draft",
		verdict: "COMMENT",
		body: "typed summary",
	});
	getDb().update(draftComments).set({ userEdit: "correction" }).run();
	elapsed("one");
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("rejected");
	expect(posts).toEqual([]);
	expect(getDb().select().from(reviewDrafts).get()?.summaryMarkdown).toBe("saved summary");
	expect(getDb().select().from(draftComments).get()?.userEdit).toBe("correction");
});
test("draft publication uses reviewed payload and guarded provider calls", async () => {
	draft();
	await prepare("one", {
		kind: "draft",
		draftId: "draft",
		verdict: "COMMENT",
		body: "typed summary",
	});
	elapsed("one");
	const result = await pub.dispatchQueuePRPublication("one");
	expect(result.status).toBe("submitted");
	expect(result.outcome?.postedCount).toBe(1);
	expect(posts).toHaveLength(2);
	expect(posts[1]).toEqual({ event: "COMMENT", body: "typed summary", commit_id: "head" });
});
test("reply must belong to current PR and never acknowledges by opening", async () => {
	await prepare("one", { kind: "reply", commentId: "other-pr-thread", body: "Reply" });
	elapsed("one");
	expect((await pub.dispatchQueuePRPublication("one")).status).toBe("rejected");
	expect(posts).toEqual([]);
	await prepare("two", { kind: "reply", commentId: "thread", body: "Reply" });
	elapsed("two");
	expect((await pub.dispatchQueuePRPublication("two")).status).toBe("submitted");
	expect(posts).toHaveLength(1);
});

test("queue solver Undo blocks both git push and replies", async () => {
	await prepare("solve", { kind: "solve", sessionId: "solver" });
	await expect(pub.dispatchQueuePRPublication("solve")).rejects.toThrow("undo period");
	pub.cancelQueuePRPublication("solve");
	elapsed("solve");
	expect((await pub.dispatchQueuePRPublication("solve")).status).toBe("cancelled");
	expect(pushes).toBe(0);
	expect(posts).toEqual([]);
});
test("queue solver publishes once and verifies pushed head before exact reply", async () => {
	await prepare("solve", { kind: "solve", sessionId: "solver" });
	elapsed("solve");
	expect((await pub.dispatchQueuePRPublication("solve")).status).toBe("submitted");
	expect(pushes).toBe(1);
	expect(posts).toHaveLength(1);
	await pub.dispatchQueuePRPublication("solve");
	expect(pushes).toBe(1);
});
test("solver group or reply edits during Undo cancel before push", async () => {
	await prepare("solve", { kind: "solve", sessionId: "solver", groupId: "group" });
	elapsed("solve");
	solveSignature = "changed";
	expect((await pub.dispatchQueuePRPublication("solve")).status).toBe("rejected");
	expect(pushes).toBe(0);
});
test("partial solver publication keeps durable uncertainty and blocks new IDs", async () => {
	await prepare("solve", { kind: "solve", sessionId: "solver" });
	elapsed("solve");
	failSolvePost = true;
	expect((await pub.dispatchQueuePRPublication("solve")).status).toBe("attempted");
	await expect(prepare("again", { kind: "solve", sessionId: "solver" })).rejects.toThrow(
		"unknown outcome"
	);
	expect(pushes).toBe(1);
});

test("losing concurrent validation cannot downgrade another caller's submitted receipt", async () => {
	await prepare("race");
	elapsed("race");
	let release!: (value: { headSha: string; state: string }) => void;
	stateResponder = () => {
		stateResponder = undefined;
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const delayed = pub.dispatchQueuePRPublication("race");
	const won = await pub.dispatchQueuePRPublication("race");
	expect(won.status).toBe("submitted");
	release({ headSha: "changed", state: "open" });
	expect((await delayed).status).toBe("submitted");
	await expect(prepare("retry")).rejects.toThrow("reservation");
	expect(posts).toHaveLength(1);
});

test("current draft edit during publisher reads blocks stale text before POST", async () => {
	draft();
	await prepare("draft-race", {
		kind: "draft",
		draftId: "draft",
		verdict: "COMMENT",
		body: "typed",
	});
	elapsed("draft-race");
	let reads = 0;
	stateHook = () => {
		if (++reads === 2)
			getDb().update(draftComments).set({ userEdit: "Correction: do NOT deploy" }).run();
	};
	expect((await pub.dispatchQueuePRPublication("draft-race")).status).toBe("rejected");
	expect(posts).toHaveLength(0);
	expect(getDb().select().from(draftComments).get()?.userEdit).toBe("Correction: do NOT deploy");
	expect(getDb().select().from(draftComments).get()?.status).toBe("user-pending");
});
test("edit during successful network POST survives local receipt cleanup", async () => {
	draft();
	await prepare("draft-post-race", {
		kind: "draft",
		draftId: "draft",
		verdict: "COMMENT",
		body: "typed",
	});
	elapsed("draft-post-race");
	inlineHook = () => getDb().update(draftComments).set({ userEdit: "Newer correction" }).run();
	expect((await pub.dispatchQueuePRPublication("draft-post-race")).status).toBe("attempted");
	expect(posts).toHaveLength(1);
	expect(getDb().select().from(draftComments).get()?.userEdit).toBe("Newer correction");
	expect(getDb().select().from(draftComments).get()?.status).toBe("user-pending");
	await expect(
		prepare("again", { kind: "review", verdict: "COMMENT", body: "new" })
	).rejects.toThrow("unknown outcome");
});
test("resolution draft cannot reference another PR's global thread", async () => {
	draft();
	const now = new Date();
	getDb()
		.insert(reviewDrafts)
		.values({
			id: "foreign",
			prProvider: "github",
			prIdentifier: "other/repo#8",
			prTitle: "Other",
			prAuthor: "author",
			sourceBranch: "branch",
			targetBranch: "main",
			status: "submitted",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(draftComments)
		.values({
			id: "original",
			reviewDraftId: "foreign",
			filePath: "file.ts",
			body: "old",
			status: "submitted",
			platformCommentId: "foreign-thread",
			createdAt: now,
		})
		.run();
	getDb()
		.update(draftComments)
		.set({ previousCommentId: "original", resolution: "resolved-by-code" })
		.where(eq(draftComments.id, "comment"))
		.run();
	await expect(
		prepare("foreign", { kind: "draft", draftId: "draft", verdict: "COMMENT", body: "" })
	).rejects.toThrow("another PR");
	expect(posts).toHaveLength(0);
});
test("same-PR draft resolution still verifies current provider thread membership", async () => {
	draft();
	getDb()
		.insert(draftComments)
		.values({
			id: "original",
			reviewDraftId: "draft",
			filePath: "file.ts",
			body: "old",
			status: "submitted",
			platformCommentId: "foreign-thread",
			createdAt: new Date(),
		})
		.run();
	getDb()
		.update(draftComments)
		.set({ previousCommentId: "original", resolution: "resolved-by-code" })
		.where(eq(draftComments.id, "comment"))
		.run();
	await prepare("foreign-thread", {
		kind: "draft",
		draftId: "draft",
		verdict: "COMMENT",
		body: "",
	});
	elapsed("foreign-thread");
	expect((await pub.dispatchQueuePRPublication("foreign-thread")).status).toBe("rejected");
	expect(posts).toHaveLength(0);
});
test("read-only failure after claim remains retryable when no mutation began", async () => {
	await prepare("read-failure");
	elapsed("read-failure");
	let reads = 0;
	stateHook = () => {
		if (++reads === 2) throw Error("temporary GET failure");
	};
	expect((await pub.dispatchQueuePRPublication("read-failure")).status).toBe("rejected");
	expect(posts).toHaveLength(0);
	stateHook = undefined;
	await prepare("retry-read");
	elapsed("retry-read");
	expect((await pub.dispatchQueuePRPublication("retry-read")).status).toBe("submitted");
	expect(posts).toHaveLength(1);
});
test("expired slow preflight cannot publish after a newer reservation wins", async () => {
	await prepare("slow");
	elapsed("slow");
	let release!: (value: { headSha: string; state: string }) => void;
	stateResponder = () => {
		stateResponder = undefined;
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	const delayed = pub.dispatchQueuePRPublication("slow");
	const key = "queue-pr-publication:slow";
	const value = getDb().select().from(sessionState).where(eq(sessionState.key, key)).get()!;
	getDb()
		.update(sessionState)
		.set({ value: JSON.stringify({ ...JSON.parse(value.value), expiresAt: Date.now() - 1 }) })
		.where(eq(sessionState.key, key))
		.run();
	await prepare("newer");
	elapsed("newer");
	expect((await pub.dispatchQueuePRPublication("newer")).status).toBe("submitted");
	release({ headSha: "head", state: "open" });
	expect((await delayed).status).toBe("rejected");
	expect(posts).toHaveLength(1);
});
