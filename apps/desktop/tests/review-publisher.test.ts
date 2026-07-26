import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { publishReview } from "../src/main/ai-review/review-publisher";
import { _setDbForTesting } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { registerGitProvider } from "../src/main/providers/git-provider";
import type {
	CreateCommentParams,
	GitProvider,
	ReplyParams,
	ResolveParams,
	SubmitReviewParams,
} from "../src/main/providers/types";
import { makeTestDb } from "./test-db";

const providerName = "review-publisher-test";

function makeProvider(overrides: Partial<GitProvider> = {}): GitProvider {
	return {
		name: providerName,
		isConnected: () => true,
		getMyPRs: async () => [],
		getPRState: async () => ({ headSha: "head-sha", state: "open" }),
		getPRComments: async () => [],
		getPRCommentsIfChanged: async () => ({ changed: true, comments: [], cacheKey: "v1" }),
		createInlineComment: async () => ({ id: "comment-1", nodeId: "thread-1" }),
		replyToComment: async () => ({ id: "reply-1" }),
		resolveComment: async () => {},
		unresolveComment: async () => {},
		submitReview: async () => {},
		getPRFiles: async () => [
			{ path: "src/good.ts", status: "modified" },
			{ path: "src/bad.ts", status: "modified" },
		],
		getReviewThreads: async () => [],
		getPRDetails: async () => {
			throw new Error("not used");
		},
		...overrides,
	};
}

function insertDraft(
	db: ReturnType<typeof makeTestDb>,
	id: string,
	overrides: Partial<typeof schema.reviewDrafts.$inferInsert> = {}
) {
	const now = new Date();
	db.insert(schema.reviewDrafts)
		.values({
			id,
			prProvider: providerName,
			prIdentifier: "owner/repo#7",
			prTitle: "Review publisher",
			prAuthor: "author",
			sourceBranch: "feature",
			targetBranch: "main",
			status: "ready",
			commitSha: "stored-sha",
			createdAt: now,
			updatedAt: now,
			...overrides,
		})
		.run();
}

function insertComment(
	db: ReturnType<typeof makeTestDb>,
	id: string,
	reviewDraftId: string,
	overrides: Partial<typeof schema.draftComments.$inferInsert> = {}
) {
	db.insert(schema.draftComments)
		.values({
			id,
			reviewDraftId,
			filePath: "src/good.ts",
			lineNumber: 12,
			side: "RIGHT",
			body: "Original body",
			status: "user-pending",
			createdAt: new Date(),
			...overrides,
		})
		.run();
}

describe("publishReview", () => {
	let db: ReturnType<typeof makeTestDb>;

	beforeEach(() => {
		db = makeTestDb();
		_setDbForTesting(db);
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("publishes accepted comments, persists platform state, and submits an empty-body verdict", async () => {
		const inlineCalls: CreateCommentParams[] = [];
		const verdictCalls: SubmitReviewParams[] = [];
		registerGitProvider(
			makeProvider({
				createInlineComment: async (input) => {
					inlineCalls.push(input);
					return { id: "comment-1", nodeId: "thread-1" };
				},
				submitReview: async (input) => {
					verdictCalls.push(input);
				},
			})
		);
		insertDraft(db, "draft-1");
		insertComment(db, "accepted", "draft-1", { userEdit: "Edited body" });
		insertComment(db, "unaccepted-edit", "draft-1", { status: "edited" });

		const result = await publishReview("draft-1", "APPROVE");

		expect(result).toMatchObject({
			success: true,
			postedCount: 1,
			failedCount: 0,
			skippedCount: 0,
			verdictSubmitted: true,
		});
		expect(inlineCalls).toHaveLength(1);
		expect(inlineCalls[0]).toMatchObject({
			filePath: "src/good.ts",
			body: "Edited body",
			commitId: "head-sha",
		});
		expect(verdictCalls).toEqual([
			{
				owner: "owner",
				repo: "repo",
				prNumber: 7,
				verdict: "APPROVE",
				body: "",
			},
		]);

		const accepted = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.id, "accepted"))
			.get();
		const unaccepted = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.id, "unaccepted-edit"))
			.get();
		const draft = db
			.select()
			.from(schema.reviewDrafts)
			.where(eq(schema.reviewDrafts.id, "draft-1"))
			.get();
		expect(accepted).toMatchObject({ status: "submitted", platformCommentId: "thread-1" });
		expect(unaccepted?.status).toBe("edited");
		expect(draft?.status).toBe("submitted");
	});

	test("publishes follow-up resolutions as replies and updates the original thread state", async () => {
		const replyCalls: ReplyParams[] = [];
		const resolveCalls: ResolveParams[] = [];
		const unresolveCalls: ResolveParams[] = [];
		registerGitProvider(
			makeProvider({
				replyToComment: async (input) => {
					replyCalls.push(input);
					return { id: "reply-1" };
				},
				resolveComment: async (input) => {
					resolveCalls.push(input);
				},
				unresolveComment: async (input) => {
					unresolveCalls.push(input);
				},
			})
		);
		insertDraft(db, "previous", { status: "submitted" });
		insertComment(db, "original", "previous", {
			status: "submitted",
			platformCommentId: "thread-original",
		});
		insertComment(db, "original-resolved", "previous", {
			status: "submitted",
			platformCommentId: "thread-resolved",
		});
		insertDraft(db, "follow-up", { previousDraftId: "previous", roundNumber: 2 });
		insertComment(db, "resolution", "follow-up", {
			previousCommentId: "original",
			resolution: "resolved-by-code",
			body: "Fixed by the latest commit",
		});
		insertComment(db, "regression", "follow-up", {
			previousCommentId: "original-resolved",
			resolution: "incorrectly-resolved",
			body: "This issue is still present",
		});

		const result = await publishReview("follow-up");

		expect(result).toMatchObject({ success: true, postedCount: 2, verdictSubmitted: false });
		expect(replyCalls).toEqual([
			{
				owner: "owner",
				repo: "repo",
				prNumber: 7,
				commentId: "thread-original",
				body: "Fixed by the latest commit",
			},
			{
				owner: "owner",
				repo: "repo",
				prNumber: 7,
				commentId: "thread-resolved",
				body: "This issue is still present",
			},
		]);
		expect(resolveCalls).toEqual([
			{ owner: "owner", repo: "repo", prNumber: 7, commentId: "thread-original" },
		]);
		expect(unresolveCalls).toEqual([
			{ owner: "owner", repo: "repo", prNumber: 7, commentId: "thread-resolved" },
		]);
		const resolution = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.id, "resolution"))
			.get();
		expect(resolution).toMatchObject({
			status: "submitted",
			platformCommentId: "thread-original",
		});
		const regression = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.id, "regression"))
			.get();
		expect(regression).toMatchObject({
			status: "submitted",
			platformCommentId: "thread-resolved",
		});
	});

	test("keeps a partially failed draft retryable without duplicating successful comments", async () => {
		const verdictCalls: SubmitReviewParams[] = [];
		registerGitProvider(
			makeProvider({
				createInlineComment: async (input) => {
					if (input.filePath === "src/bad.ts") throw new Error("position rejected");
					return { id: "comment-good", nodeId: "thread-good" };
				},
				submitReview: async (input) => {
					verdictCalls.push(input);
				},
			})
		);
		insertDraft(db, "draft-partial");
		insertComment(db, "good", "draft-partial");
		insertComment(db, "bad", "draft-partial", { filePath: "src/bad.ts" });

		const result = await publishReview("draft-partial", "REQUEST_CHANGES");

		expect(result).toMatchObject({
			success: false,
			postedCount: 1,
			failedCount: 1,
			verdictSubmitted: false,
		});
		expect(result.errors[0]).toContain("position rejected");
		expect(verdictCalls).toHaveLength(0);
		const comments = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.reviewDraftId, "draft-partial"))
			.all();
		expect(comments.find((comment) => comment.id === "good")?.status).toBe("submitted");
		expect(comments.find((comment) => comment.id === "bad")?.status).toBe("user-pending");
		const draft = db
			.select()
			.from(schema.reviewDrafts)
			.where(eq(schema.reviewDrafts.id, "draft-partial"))
			.get();
		expect(draft?.status).toBe("ready");
	});
});
