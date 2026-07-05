import { describe, expect, test } from "bun:test";
import { postAcceptedDrafts } from "../src/renderer/lib/pr-review-submit";
import type { AIDraftThread, PRContext } from "../src/shared/github-types";

const prCtx: PRContext = {
	provider: "github",
	owner: "octo",
	repo: "repo",
	number: 42,
	title: "Improve review UI",
	sourceBranch: "feature",
	targetBranch: "main",
	repoPath: "/tmp/repo",
};

function aiThread(overrides: Partial<AIDraftThread> = {}): AIDraftThread {
	return {
		id: "ai-1",
		isAIDraft: true,
		draftCommentId: "draft-1",
		path: "src/app.ts",
		line: 12,
		diffSide: "RIGHT",
		body: "Original body",
		status: "user-pending",
		userEdit: null,
		createdAt: "2026-07-05T00:00:00.000Z",
		...overrides,
	};
}

describe("postAcceptedDrafts", () => {
	test("posts accepted drafts, marks them submitted, and submits non-empty verdict", async () => {
		const calls: string[] = [];
		const outcome = await postAcceptedDrafts({
			prCtx,
			headCommitOid: "abc123",
			threads: [
				aiThread({ draftCommentId: "draft-1", body: "Original body" }),
				aiThread({
					id: "ai-2",
					draftCommentId: "draft-2",
					path: "src/other.ts",
					line: null,
					userEdit: "Edited body",
				}),
			],
			verdict: "APPROVE",
			body: "Looks good",
			deps: {
				createReviewThread: async (input) => {
					calls.push(`thread:${input.path}:${input.body}`);
				},
				updateDraftComment: async (input) => {
					calls.push(`status:${input.commentId}:${input.status}`);
				},
				submitReview: async (input) => {
					calls.push(`verdict:${input.verdict}:${input.body}`);
				},
			},
		});

		expect(outcome.posted).toBe(2);
		expect(outcome.failed).toBe(0);
		expect(outcome.verdictSubmitted).toBe(true);
		expect(calls).toEqual([
			"thread:src/app.ts:Original body",
			"status:draft-1:submitted",
			"thread:src/other.ts:Edited body",
			"status:draft-2:submitted",
			"verdict:APPROVE:Looks good",
		]);
	});

	test("marks failed draft rows as error and skips verdict when every inline post fails", async () => {
		const statusUpdates: string[] = [];
		const outcome = await postAcceptedDrafts({
			prCtx,
			headCommitOid: "abc123",
			threads: [aiThread()],
			verdict: "REQUEST_CHANGES",
			body: "Please fix",
			deps: {
				createReviewThread: async () => {
					throw new Error("GitHub rejected the position");
				},
				updateDraftComment: async (input) => {
					statusUpdates.push(`${input.commentId}:${input.status}`);
				},
				submitReview: async () => {
					throw new Error("verdict should be skipped");
				},
			},
		});

		expect(outcome.posted).toBe(0);
		expect(outcome.failed).toBe(1);
		expect(outcome.verdictSubmitted).toBe(false);
		expect(outcome.skippedVerdict).toBe(true);
		expect(outcome.errors[0]).toContain("GitHub rejected the position");
		expect(statusUpdates).toEqual(["draft-1:error"]);
	});

	test("reports missing head commit without posting or mutating drafts", async () => {
		let mutationCount = 0;
		const outcome = await postAcceptedDrafts({
			prCtx,
			headCommitOid: "",
			threads: [aiThread()],
			verdict: "COMMENT",
			body: "",
			deps: {
				createReviewThread: async () => {
					mutationCount++;
				},
				updateDraftComment: async () => {
					mutationCount++;
				},
				submitReview: async () => {
					mutationCount++;
				},
			},
		});

		expect(outcome.posted).toBe(0);
		expect(outcome.failed).toBe(1);
		expect(outcome.errors).toEqual(["Missing head commit SHA"]);
		expect(mutationCount).toBe(0);
	});

	test("does not submit an empty COMMENT verdict after posting inline comments", async () => {
		let verdictCount = 0;
		const outcome = await postAcceptedDrafts({
			prCtx,
			headCommitOid: "abc123",
			threads: [aiThread()],
			verdict: "COMMENT",
			body: "   ",
			deps: {
				createReviewThread: async () => {},
				updateDraftComment: async () => {},
				submitReview: async () => {
					verdictCount++;
				},
			},
		});

		expect(outcome.posted).toBe(1);
		expect(outcome.failed).toBe(0);
		expect(outcome.verdictSubmitted).toBe(false);
		expect(verdictCount).toBe(0);
	});
});
