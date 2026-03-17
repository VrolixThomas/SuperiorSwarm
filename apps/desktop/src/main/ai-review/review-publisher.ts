import { eq } from "drizzle-orm";
import { createPRComment, replyToPRComment } from "../atlassian/bitbucket";
import { getDb } from "../db";
import * as schema from "../db/schema";
import {
	addReviewThreadReply,
	createReviewThread,
	resolveThread,
	submitReview,
	unresolveThread,
} from "../github/github";

interface PublishResult {
	success: boolean;
	postedCount: number;
	errors: string[];
}

/** Parse a pr_identifier like "owner/repo#123" into parts */
function parsePrIdentifier(identifier: string): {
	ownerOrWorkspace: string;
	repo: string;
	number: number;
} {
	const [ownerRepo, numStr] = identifier.split("#");
	const [ownerOrWorkspace, repo] = ownerRepo!.split("/");
	return { ownerOrWorkspace: ownerOrWorkspace!, repo: repo!, number: Number.parseInt(numStr!, 10) };
}

/** Publish approved draft comments to GitHub or Bitbucket */
export async function publishReview(draftId: string): Promise<PublishResult> {
	const db = getDb();
	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();

	if (!draft) return { success: false, postedCount: 0, errors: ["Draft not found"] };

	// Get approved and edited comments (excluding resolution comments handled separately)
	const comments = db
		.select()
		.from(schema.draftComments)
		.where(eq(schema.draftComments.reviewDraftId, draftId))
		.all()
		.filter(
			(c) =>
				(c.status === "approved" || c.status === "edited") &&
				c.resolution !== "resolved-by-code" &&
				c.resolution !== "incorrectly-resolved"
		);

	const { ownerOrWorkspace, repo, number: prNumber } = parsePrIdentifier(draft.prIdentifier);
	const errors: string[] = [];
	let postedCount = 0;

	if (draft.prProvider === "github") {
		// Post inline comments via GitHub API
		for (const comment of comments) {
			try {
				const body =
					comment.status === "edited" && comment.userEdit ? comment.userEdit : comment.body;

				if (comment.lineNumber) {
					const result = await createReviewThread({
						owner: ownerOrWorkspace,
						repo,
						prNumber,
						body,
						commitId: draft.commitSha!,
						path: comment.filePath,
						line: comment.lineNumber,
						side: (comment.side as "LEFT" | "RIGHT") ?? "RIGHT",
					});
					// Save platform comment ID for follow-up resolution
					db.update(schema.draftComments)
						.set({ platformCommentId: result.nodeId })
						.where(eq(schema.draftComments.id, comment.id))
						.run();
				}
				postedCount++;
			} catch (err) {
				errors.push(`Failed to post comment on ${comment.filePath}:${comment.lineNumber}: ${err}`);
			}
		}

		// Submit overall review with summary
		if (draft.summaryMarkdown) {
			try {
				await submitReview({
					owner: ownerOrWorkspace,
					repo,
					prNumber,
					verdict: "COMMENT",
					body: draft.summaryMarkdown,
				});
			} catch (err) {
				errors.push(`Failed to submit review summary: ${err}`);
			}
		}
	} else if (draft.prProvider === "bitbucket") {
		// Post comments via Bitbucket API
		for (const comment of comments) {
			try {
				const body =
					comment.status === "edited" && comment.userEdit ? comment.userEdit : comment.body;

				const result = await createPRComment(
					ownerOrWorkspace,
					repo,
					prNumber,
					body,
					comment.lineNumber ? comment.filePath : undefined,
					comment.lineNumber ?? undefined
				);
				// Save platform comment ID
				db.update(schema.draftComments)
					.set({ platformCommentId: String(result.id) })
					.where(eq(schema.draftComments.id, comment.id))
					.run();
				postedCount++;
			} catch (err) {
				errors.push(`Failed to post comment on ${comment.filePath}:${comment.lineNumber}: ${err}`);
			}
		}

		// Post summary as a general comment
		if (draft.summaryMarkdown) {
			try {
				await createPRComment(ownerOrWorkspace, repo, prNumber, draft.summaryMarkdown);
			} catch (err) {
				errors.push(`Failed to post review summary: ${err}`);
			}
		}
	}

	// Handle resolution comments from follow-up reviews
	const resolutionComments = db
		.select()
		.from(schema.draftComments)
		.where(eq(schema.draftComments.reviewDraftId, draftId))
		.all()
		.filter(
			(c) =>
				(c.status === "approved" || c.status === "edited") &&
				(c.resolution === "resolved-by-code" || c.resolution === "incorrectly-resolved")
		);

	for (const comment of resolutionComments) {
		if (!comment.previousCommentId) continue;

		// Find the original comment to get its platformCommentId
		const originalComment = db
			.select()
			.from(schema.draftComments)
			.where(eq(schema.draftComments.id, comment.previousCommentId))
			.get();

		if (!originalComment?.platformCommentId) continue;

		const body =
			comment.status === "edited" && comment.userEdit ? comment.userEdit : comment.body;

		try {
			if (draft.prProvider === "github") {
				await addReviewThreadReply({
					threadId: originalComment.platformCommentId,
					body,
				});

				if (comment.resolution === "resolved-by-code") {
					await resolveThread(originalComment.platformCommentId);
				} else if (comment.resolution === "incorrectly-resolved") {
					await unresolveThread(originalComment.platformCommentId);
				}
			} else if (draft.prProvider === "bitbucket") {
				const parentId = Number.parseInt(originalComment.platformCommentId, 10);
				await replyToPRComment(ownerOrWorkspace, repo, prNumber, parentId, body);
			}
			postedCount++;
		} catch (err) {
			errors.push(`Failed to post resolution for ${comment.filePath}: ${err}`);
		}
	}

	// Update draft status
	db.update(schema.reviewDrafts)
		.set({ status: "submitted", updatedAt: new Date() })
		.where(eq(schema.reviewDrafts.id, draftId))
		.run();

	return { success: errors.length === 0, postedCount, errors };
}
