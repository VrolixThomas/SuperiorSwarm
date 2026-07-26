import { eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { getGitProvider } from "../providers/git-provider";
import type { NormalizedPRFile } from "../providers/types";
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

/**
 * Build a map of valid file paths and a rename map (old → new) from PR files.
 * Used to validate and remap comment paths before publishing.
 */
function buildPathMaps(files: NormalizedPRFile[]): {
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
export async function publishReview(
	draftId: string,
	verdict: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" = "COMMENT"
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
	let skippedCount = 0;
	let failedCount = 0;
	let verdictSubmitted = false;

	const git = getGitProvider(draft.prProvider);

	// Fetch PR files for path validation
	let commitId = draft.commitSha ?? undefined;
	let validPaths = new Set<string>();
	let renameMap = new Map<string, string>();

	try {
		const [prState, prFiles] = await Promise.all([
			git.getPRState(owner, repo, prNumber),
			git.getPRFiles(owner, repo, prNumber),
		]);
		commitId = prState.headSha;
		const maps = buildPathMaps(prFiles);
		validPaths = maps.validPaths;
		renameMap = maps.renameMap;
	} catch (err) {
		console.error("[review-publisher] Failed to fetch PR state/files, using stored commit:", err);
	}

	// Post comments
	for (const comment of comments) {
		try {
			const body = comment.userEdit ?? comment.body;

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

			const result = await git.createInlineComment({
				owner,
				repo,
				prNumber,
				body: commentBody,
				filePath,
				...(commitId ? { commitId } : {}),
				...(comment.lineNumber
					? { line: comment.lineNumber, side: (comment.side as "LEFT" | "RIGHT") ?? "RIGHT" }
					: {}),
			});
			db.update(schema.draftComments)
				.set({ platformCommentId: result.nodeId ?? result.id, status: "submitted" })
				.where(eq(schema.draftComments.id, comment.id))
				.run();
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

			db.update(schema.draftComments)
				.set({ platformCommentId: originalComment.platformCommentId, status: "submitted" })
				.where(eq(schema.draftComments.id, comment.id))
				.run();
			postedCount++;
		} catch (err) {
			failedCount++;
			errors.push(`Failed to post resolution for ${comment.filePath}: ${err}`);
		}
	}

	// Submit the verdict only after every accepted inline/resolution comment has
	// succeeded. Successfully posted rows are already marked submitted, so a
	// retry cannot duplicate them.
	if (failedCount === 0 && skippedCount === 0 && (draft.summaryMarkdown || verdict !== "COMMENT")) {
		try {
			await git.submitReview({
				owner,
				repo,
				prNumber,
				verdict,
				body: draft.summaryMarkdown ?? "",
			});
			verdictSubmitted = true;
		} catch (err) {
			failedCount++;
			errors.push(`Failed to submit review summary: ${err}`);
		}
	}

	const success = failedCount === 0 && skippedCount === 0;
	if (success) {
		db.update(schema.reviewDrafts)
			.set({ status: "submitted", updatedAt: new Date() })
			.where(eq(schema.reviewDrafts.id, draftId))
			.run();
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
