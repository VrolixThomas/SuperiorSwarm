import { eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import type { GitProvider } from "../providers/types";
import { parsePrIdentifier } from "./pr-identifier";

export interface PublishResult {
	success: boolean;
	postedCount: number;
	skippedCount: number;
	failedCount: number;
	errors: string[];
	verdictSubmitted: boolean;
}

const ACCEPTED_COMMENT_STATUSES = new Set(["approved", "user-pending"]);

/** Publish approved draft comments to GitHub or Bitbucket */
export async function publishReview(
	draftId: string,
	verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" = "COMMENT",
	options?: {
		provider: GitProvider;
		body: string;
		beforePersist?: () => void;
		afterPersist?: () => void;
	}
): Promise<PublishResult> {
	const db = getDb();
	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();

	if (!draft)
		return {
			success: false,
			postedCount: 0,
			skippedCount: 0,
			failedCount: 1,
			errors: ["Draft not found"],
			verdictSubmitted: false,
		};

	const draftComments = db
		.select()
		.from(schema.draftComments)
		.where(eq(schema.draftComments.reviewDraftId, draftId))
		.all();
	const comments = draftComments.filter(
		(c) =>
			ACCEPTED_COMMENT_STATUSES.has(c.status) &&
			c.resolution !== "resolved-by-code" &&
			c.resolution !== "incorrectly-resolved"
	);

	const { owner, repo, number: prNumber } = parsePrIdentifier(draft.prIdentifier);
	const errors: string[] = [];
	let postedCount = 0;
	const skippedCount = 0;
	let failedCount = 0;
	let verdictSubmitted = false;

	const git = options?.provider ?? getGitProvider(draft.prProvider);
	const summary = options ? options.body.trim() : draft.summaryMarkdown;

	// Preflight the entire accepted submission before the first external mutation.
	// Line/side provenance is tied to the stored revision, never today's branch tip.
	const commitId = draft.commitSha ?? undefined;
	try {
		if (comments.length > 0 && !commitId)
			throw new Error(
				"Inline comments have no verified revision; recreate them against the current diff"
			);
		if (comments.length > 0 && git.supportsPinnedInlineComments === false)
			throw new Error(`${git.name} does not support revision-pinned inline comments`);
		const prState = await git.getPRState(owner, repo, prNumber);
		if (commitId && prState.headSha !== commitId)
			throw new Error(
				"PR head changed since this draft was created; review the current diff before submitting"
			);
		if (prState.state !== "open")
			throw new Error("Cannot submit a review to a closed pull request");
		if (comments.length > 0) {
			const files = await git.getPRFiles(owner, repo, prNumber);
			for (const comment of comments) {
				const exists = files.some(
					(file) =>
						(file.path === comment.filePath &&
							(comment.side === "LEFT" || file.status !== "removed")) ||
						(comment.side === "LEFT" && file.previousPath === comment.filePath)
				);
				if (!exists) throw new Error(`Comment path is not in the pinned diff: ${comment.filePath}`);
			}
			const verified = await git.getPRState(owner, repo, prNumber);
			if (verified.headSha !== commitId || verified.state !== "open")
				throw new Error(
					"PR changed while validating this draft; review the current diff before submitting"
				);
		}
	} catch (error) {
		// Queue publication must distinguish a proven preflight failure from an uncertain POST.
		if (options) throw error;
		return {
			success: false,
			postedCount: 0,
			skippedCount: 0,
			failedCount: Math.max(1, comments.length),
			errors: [error instanceof Error ? error.message : String(error)],
			verdictSubmitted: false,
		};
	}

	// Post comments
	for (const comment of comments) {
		try {
			const body = comment.userEdit ?? comment.body;

			const result = await git.createInlineComment({
				owner,
				repo,
				prNumber,
				body,
				filePath: comment.filePath,
				...(commitId ? { commitId } : {}),
				...(comment.lineNumber
					? { line: comment.lineNumber, side: (comment.side as "LEFT" | "RIGHT") ?? "RIGHT" }
					: {}),
			});
			db.transaction(() => {
				options?.beforePersist?.();
				db.update(schema.draftComments)
					.set({ platformCommentId: result.nodeId ?? result.id, status: "submitted" })
					.where(eq(schema.draftComments.id, comment.id))
					.run();
				options?.afterPersist?.();
			});
			postedCount++;
		} catch (err) {
			failedCount++;
			errors.push(
				`Failed to post comment on ${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ""}: ${err}`
			);
		}
	}

	// Handle resolution comments from follow-up reviews
	const resolutionComments = draftComments.filter(
		(c) =>
			ACCEPTED_COMMENT_STATUSES.has(c.status) &&
			(c.resolution === "resolved-by-code" || c.resolution === "incorrectly-resolved")
	);

	for (const comment of resolutionComments) {
		if (!comment.previousCommentId) {
			failedCount++;
			errors.push(`Failed to post resolution for ${comment.filePath}: previous comment is missing`);
			continue;
		}

		// Find the original comment to get its platformCommentId
		const originalComment = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.id, comment.previousCommentId))
			.get();

		if (!originalComment?.platformCommentId) {
			failedCount++;
			errors.push(`Failed to post resolution for ${comment.filePath}: platform thread is missing`);
			continue;
		}

		const body = comment.userEdit ?? comment.body;

		try {
			await git.replyToComment({
				owner,
				repo,
				prNumber,
				commentId: originalComment.platformCommentId,
				body,
			});

			if (comment.resolution === "resolved-by-code") {
				await git.resolveComment({
					owner,
					repo,
					prNumber,
					commentId: originalComment.platformCommentId,
				});
			} else if (comment.resolution === "incorrectly-resolved") {
				await git.unresolveComment({
					owner,
					repo,
					prNumber,
					commentId: originalComment.platformCommentId,
				});
			}

			db.transaction(() => {
				options?.beforePersist?.();
				db.update(schema.draftComments)
					.set({ platformCommentId: originalComment.platformCommentId, status: "submitted" })
					.where(eq(schema.draftComments.id, comment.id))
					.run();
				options?.afterPersist?.();
			});
			postedCount++;
		} catch (err) {
			failedCount++;
			errors.push(`Failed to post resolution for ${comment.filePath}: ${err}`);
		}
	}

	// Submit the verdict only after every accepted inline/resolution comment has
	// succeeded. Successfully posted rows are already marked submitted, so a
	// retry cannot duplicate them.
	if (failedCount === 0 && skippedCount === 0 && (summary || verdict !== "COMMENT")) {
		try {
			await git.submitReview({
				owner,
				repo,
				prNumber,
				verdict,
				body: summary ?? "",
			});
			verdictSubmitted = true;
		} catch (err) {
			failedCount++;
			errors.push(`Failed to submit review summary: ${err}`);
		}
	}

	const success = failedCount === 0 && skippedCount === 0;
	if (success) {
		db.transaction(() => {
			options?.beforePersist?.();
			db.update(schema.reviewDrafts)
				.set({ status: "submitted", updatedAt: new Date() })
				.where(eq(schema.reviewDrafts.id, draftId))
				.run();
		});
	}

	return {
		success,
		postedCount,
		skippedCount,
		failedCount,
		errors,
		verdictSubmitted,
	};
}
