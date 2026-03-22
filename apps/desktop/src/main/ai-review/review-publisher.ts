import { eq } from "drizzle-orm";
import { createPRComment, replyToPRComment } from "../atlassian/bitbucket";
import { getDb } from "../db";
import * as schema from "../db/schema";
import {
	type PRFileInfo,
	addReviewThreadReply,
	createReviewThread,
	getPRFiles,
	getPRState,
	resolveThread,
	submitReview,
	unresolveThread,
} from "../github/github";

interface PublishResult {
	success: boolean;
	postedCount: number;
	skippedCount: number;
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

/**
 * Build a map of valid file paths and a rename map (old → new) from PR files.
 * Used to validate and remap comment paths before publishing.
 */
function buildPathMaps(files: PRFileInfo[]): {
	validPaths: Set<string>;
	renameMap: Map<string, string>;
} {
	const validPaths = new Set<string>();
	const renameMap = new Map<string, string>();

	for (const f of files) {
		if (f.status !== "removed") {
			validPaths.add(f.path);
		}
		if (f.status === "renamed" && f.previousPath) {
			renameMap.set(f.previousPath, f.path);
		}
	}

	return { validPaths, renameMap };
}

/**
 * Resolve a comment's file path against the current PR diff.
 * Returns the resolved path, or null if the file no longer exists.
 */
function resolveCommentPath(
	filePath: string,
	validPaths: Set<string>,
	renameMap: Map<string, string>
): { path: string; renamed: boolean; originalPath?: string } | null {
	// Path exists in current diff — use as-is
	if (validPaths.has(filePath)) {
		return { path: filePath, renamed: false };
	}

	// Check if file was renamed
	const newPath = renameMap.get(filePath);
	if (newPath) {
		return { path: newPath, renamed: true, originalPath: filePath };
	}

	// File no longer exists in PR diff
	return null;
}

/** Publish approved draft comments to GitHub or Bitbucket */
export async function publishReview(draftId: string): Promise<PublishResult> {
	const db = getDb();
	const draft = db
		.select()
		.from(schema.reviewDrafts)
		.where(eq(schema.reviewDrafts.id, draftId))
		.get();

	if (!draft)
		return { success: false, postedCount: 0, skippedCount: 0, errors: ["Draft not found"] };

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
	let skippedCount = 0;

	if (draft.prProvider === "github") {
		// Fetch current PR state and files for path validation
		let commitId = draft.commitSha!;
		let validPaths = new Set<string>();
		let renameMap = new Map<string, string>();

		try {
			const [prState, prFiles] = await Promise.all([
				getPRState(ownerOrWorkspace, repo, prNumber),
				getPRFiles(ownerOrWorkspace, repo, prNumber),
			]);
			commitId = prState.headSha;
			const maps = buildPathMaps(prFiles);
			validPaths = maps.validPaths;
			renameMap = maps.renameMap;
		} catch (err) {
			console.error("[review-publisher] Failed to fetch PR state/files, using stored commit:", err);
			// Fall back to stored commit SHA and skip path validation
		}

		// Post comments via GitHub API
		for (const comment of comments) {
			try {
				const body =
					comment.status === "edited" && comment.userEdit ? comment.userEdit : comment.body;

				// Validate and remap file path if we have PR file info
				let filePath = comment.filePath;
				if (validPaths.size > 0) {
					const resolved = resolveCommentPath(filePath, validPaths, renameMap);
					if (!resolved) {
						skippedCount++;
						errors.push(
							`Skipped comment on ${filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ""} — file no longer exists in PR`
						);
						continue;
					}
					filePath = resolved.path;
				}

				const commentBody =
					filePath !== comment.filePath
						? `*(File was renamed from \`${comment.filePath}\`)*\n\n${body}`
						: body;

				const result = await createReviewThread({
					owner: ownerOrWorkspace,
					repo,
					prNumber,
					body: commentBody,
					commitId,
					path: filePath,
					...(comment.lineNumber
						? {
								line: comment.lineNumber,
								side: (comment.side as "LEFT" | "RIGHT") ?? "RIGHT",
							}
						: {}),
				});
				// Save platform comment ID for follow-up resolution
				db.update(schema.draftComments)
					.set({ platformCommentId: result.nodeId })
					.where(eq(schema.draftComments.id, comment.id))
					.run();
				postedCount++;
			} catch (err) {
				errors.push(
					`Failed to post comment on ${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ""}: ${err}`
				);
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
					comment.filePath,
					comment.lineNumber ?? undefined
				);
				// Save platform comment ID
				db.update(schema.draftComments)
					.set({ platformCommentId: String(result.id) })
					.where(eq(schema.draftComments.id, comment.id))
					.run();
				postedCount++;
			} catch (err) {
				errors.push(
					`Failed to post comment on ${comment.filePath}${comment.lineNumber ? `:${comment.lineNumber}` : ""}: ${err}`
				);
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

		const body = comment.status === "edited" && comment.userEdit ? comment.userEdit : comment.body;

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

	return { success: errors.length === 0, postedCount, skippedCount, errors };
}
