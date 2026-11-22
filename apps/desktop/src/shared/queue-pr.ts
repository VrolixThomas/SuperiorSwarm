export interface QueuePRReviewEvidence {
	headSha: string;
	viewerId: string;
	reviewId?: string;
	reviewedSha?: string;
	reviewState?: string;
	threadsComplete: boolean;
	ownThreads: { path: string; resolved: boolean }[];
	comparison: "ahead" | "identical" | "diverged" | "behind" | "unknown";
	comparisonBase?: string;
	filesComplete: boolean;
	changedFiles: string[];
	ciComplete: boolean;
	ciPassing: boolean;
	open: boolean;
	draft: boolean;
}
export interface QueuePREligibility {
	eligible: boolean;
	headSha: string;
	reasons: string[];
	evidence: string[];
}
export function evaluateQueuePRReview(value: QueuePRReviewEvidence): QueuePREligibility {
	const reasons: string[] = [];
	if (!value.open || value.draft) reasons.push("The PR must be open and ready for review.");
	if (value.reviewState !== "CHANGES_REQUESTED" || !value.reviewedSha || !value.reviewId)
		reasons.push("Your latest review must request changes at a known commit.");
	if (
		!value.threadsComplete ||
		!value.ownThreads.length ||
		value.ownThreads.some((t) => !t.resolved)
	)
		reasons.push("Every thread you started in that review must be confirmed resolved.");
	if (value.comparison !== "ahead" || value.comparisonBase !== value.reviewedSha)
		reasons.push(
			"The current head must descend from your reviewed commit; force-pushed or diverged history is ineligible."
		);
	const paths = new Set(value.ownThreads.map((t) => t.path));
	if (
		!value.filesComplete ||
		!value.changedFiles.length ||
		value.changedFiles.some((path) => !paths.has(path))
	)
		reasons.push(
			"Changed files must be completely known and restricted to files you commented on."
		);
	if (!value.ciComplete || !value.ciPassing)
		reasons.push("All CI checks must be complete and passing.");
	return {
		eligible: reasons.length === 0,
		headSha: value.headSha,
		reasons,
		evidence: [
			`Head: ${value.headSha}`,
			value.reviewId
				? `Your review: ${value.reviewId} (${value.reviewState}) at ${value.reviewedSha}`
				: "Your previous review is unavailable.",
			`${value.ownThreads.filter((t) => t.resolved).length}/${value.ownThreads.length} review threads resolved.`,
			value.filesComplete
				? `${value.changedFiles.length} changed files compared with your commented files.`
				: "Changed-file comparison incomplete.",
			value.ciComplete && value.ciPassing
				? "CI is complete and passing."
				: "CI is pending, failing, or not fully known.",
			"Resolved threads and a changed-file subset do not prove that only requested edits were made. Inspect the changes before approving.",
		],
	};
}
