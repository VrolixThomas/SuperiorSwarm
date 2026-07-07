import type { AIDraftThread, PRContext } from "../../shared/github-types";

export type ReviewVerdict = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

interface CreateReviewThreadInput {
	owner: string;
	repo: string;
	prNumber: number;
	body: string;
	commitId: string;
	path: string;
	line?: number;
	side?: "LEFT" | "RIGHT";
}

interface UpdateDraftCommentInput {
	commentId: string;
	status: "submitted" | "error";
}

interface SubmitReviewInput {
	owner: string;
	repo: string;
	prNumber: number;
	verdict: ReviewVerdict;
	body: string;
}

export interface SubmitReviewDeps {
	createReviewThread: (input: CreateReviewThreadInput) => Promise<unknown>;
	updateDraftComment: (input: UpdateDraftCommentInput) => Promise<unknown>;
	submitReview: (input: SubmitReviewInput) => Promise<unknown>;
}

/** True when submitting would perform at least one API call. */
export function hasSubmitPayload(
	acceptedCount: number,
	verdict: ReviewVerdict,
	body: string
): boolean {
	return acceptedCount > 0 || verdict !== "COMMENT" || body.trim().length > 0;
}

export interface PostAcceptedDraftsOptions {
	prCtx: PRContext;
	headCommitOid: string;
	threads: AIDraftThread[];
	verdict: ReviewVerdict;
	body: string;
	deps: SubmitReviewDeps;
}

export interface SubmitOutcome {
	posted: number;
	failed: number;
	errors: string[];
	verdictSubmitted: boolean;
	skippedVerdict: boolean;
}

export async function postAcceptedDrafts({
	prCtx,
	headCommitOid,
	threads,
	verdict,
	body,
	deps,
}: PostAcceptedDraftsOptions): Promise<SubmitOutcome> {
	if (!headCommitOid && threads.length > 0) {
		return {
			posted: 0,
			failed: threads.length,
			errors: ["Missing head commit SHA"],
			verdictSubmitted: false,
			skippedVerdict: true,
		};
	}

	let posted = 0;
	let failed = 0;
	const errors: string[] = [];

	for (const thread of threads) {
		try {
			await deps.createReviewThread({
				owner: prCtx.owner,
				repo: prCtx.repo,
				prNumber: prCtx.number,
				body: thread.userEdit ?? thread.body,
				commitId: headCommitOid,
				path: thread.path,
				...(thread.line != null ? { line: thread.line, side: thread.diffSide } : {}),
			});
			await deps.updateDraftComment({
				commentId: thread.draftCommentId,
				status: "submitted",
			});
			posted++;
		} catch (err) {
			failed++;
			const message =
				err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
			errors.push(`${thread.path}${thread.line != null ? `:${thread.line}` : ""} - ${message}`);

			try {
				await deps.updateDraftComment({
					commentId: thread.draftCommentId,
					status: "error",
				});
			} catch {
				// Best effort: keep the original post error as the user-facing failure.
			}
		}
	}

	const trimmedBody = body.trim();
	const needsVerdict = verdict !== "COMMENT" || trimmedBody.length > 0;
	if (!needsVerdict) {
		return { posted, failed, errors, verdictSubmitted: false, skippedVerdict: false };
	}

	if (threads.length > 0 && posted === 0 && failed > 0) {
		return { posted, failed, errors, verdictSubmitted: false, skippedVerdict: true };
	}

	try {
		await deps.submitReview({
			owner: prCtx.owner,
			repo: prCtx.repo,
			prNumber: prCtx.number,
			verdict,
			body: trimmedBody,
		});
		return { posted, failed, errors, verdictSubmitted: true, skippedVerdict: false };
	} catch (err) {
		failed++;
		const message = err instanceof Error ? err.message : "Review submission failed";
		errors.push(message);
		return { posted, failed, errors, verdictSubmitted: false, skippedVerdict: false };
	}
}
