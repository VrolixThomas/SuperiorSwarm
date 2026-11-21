import type { ReviewPathIdentity } from "../../shared/review-path-runtime";
import type { CachedPR } from "../../shared/review-types";

export interface AutoMapDeps {
	getSettings(): { autoMapOnReviewRequest: boolean; alsoReview: boolean };
	hasReview(pr: CachedPR): boolean;
	wasReviewed(pr: CachedPR): boolean;
	ensureWorkspace(pr: CachedPR): Promise<string>;
	/** Persistence atomically claims provider/workspace/repo/PR/head, including after restart. */
	start(identity: ReviewPathIdentity, alsoReview: boolean): Promise<{ claimed: boolean }>;
	markReviewed(pr: CachedPR): void;
}
export function createAutoMapper(deps: AutoMapDeps) {
	const pending = new Map<string, Promise<boolean>>();
	return (pr: CachedPR): Promise<boolean> => {
		const settings = deps.getSettings();
		if (
			!settings.autoMapOnReviewRequest ||
			pr.state !== "open" ||
			pr.role !== "reviewer" ||
			!pr.projectId ||
			!["github", "bitbucket"].includes(pr.provider) ||
			!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(pr.headCommitSha)
		)
			return Promise.resolve(false);
		const key = JSON.stringify([
			pr.projectId,
			pr.provider,
			pr.repoOwner,
			pr.repoName,
			pr.number,
			pr.headCommitSha,
		]);
		const existing = pending.get(key);
		if (existing) return existing;
		const result = (async () => {
			const workspaceId = await deps.ensureWorkspace(pr);
			const alsoReview = settings.alsoReview && !deps.hasReview(pr) && !deps.wasReviewed(pr);
			await deps.start(
				{
					workspaceId,
					provider: pr.provider,
					owner: pr.repoOwner,
					repo: pr.repoName,
					prNumber: pr.number,
					headSha: pr.headCommitSha,
				},
				alsoReview
			);
			// Even a durable duplicate map claim must suppress a second legacy review launch.
			if (alsoReview) deps.markReviewed(pr);
			return alsoReview;
		})().finally(() => pending.delete(key));
		pending.set(key, result);
		return result;
	};
}
