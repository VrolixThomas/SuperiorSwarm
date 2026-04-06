import type { CachedPR } from "../../shared/review-types";

export function shouldAutoTriggerReview(args: {
	pr: CachedPR;
	autoReviewEnabled: boolean;
	existingDrafts: Set<string>;
	alreadyTriggered: Set<string>;
}): boolean {
	const { pr, autoReviewEnabled, existingDrafts, alreadyTriggered } = args;

	if (!autoReviewEnabled) return false;
	if (pr.state !== "open") return false;
	if (pr.role !== "reviewer") return false;
	if (!pr.projectId) return false;
	if (existingDrafts.has(pr.identifier)) return false;
	if (alreadyTriggered.has(pr.identifier)) return false;

	return true;
}
