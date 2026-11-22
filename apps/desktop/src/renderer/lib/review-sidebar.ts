import type { BitbucketPullRequest } from "../../main/atlassian/bitbucket";
import type { GitHubPR } from "../../main/github/github";
import { type ReviewQueuePR, reviewQueueKey } from "./review-queue";

export interface ReviewSidebarFilters {
	search: string;
	repository: string;
	sections: { needsReview: boolean; authored: boolean; waitingOnAuthor: boolean };
}
export function parseReviewSidebarFilters(raw: string | null): ReviewSidebarFilters {
	const defaults: ReviewSidebarFilters = {
		search: "",
		repository: "",
		sections: { needsReview: true, authored: false, waitingOnAuthor: false },
	};
	try {
		const value: unknown = raw ? JSON.parse(raw) : null;
		if (!value || typeof value !== "object") return defaults;
		const record = value as Record<string, unknown>;
		const sections = record["sections"];
		return {
			search: typeof record["search"] === "string" ? record["search"] : "",
			repository: typeof record["repository"] === "string" ? record["repository"] : "",
			sections: Object.fromEntries(
				Object.entries(defaults.sections).map(([key, fallback]) => [
					key,
					sections &&
					typeof sections === "object" &&
					typeof (sections as Record<string, unknown>)[key] === "boolean"
						? (sections as Record<string, unknown>)[key]
						: fallback,
				])
			) as ReviewSidebarFilters["sections"],
		};
	} catch {
		return defaults;
	}
}
/** These inputs are distinct authored sources, never review-request rows relabelled as authored. */
export function buildAuthoredReviewPRs(input: {
	github?: readonly GitHubPR[];
	bitbucket?: readonly BitbucketPullRequest[];
}): ReviewQueuePR[] {
	const rows: ReviewQueuePR[] = [];
	const seen = new Set<string>();
	const add = (pr: Omit<ReviewQueuePR, "key">) => {
		const key = reviewQueueKey(pr);
		if (!seen.has(key)) {
			seen.add(key);
			rows.push({ ...pr, key });
		}
	};
	for (const pr of input.github ?? [])
		if (pr.role === "author" && pr.state === "open")
			add({
				provider: "github",
				owner: pr.repoOwner,
				repo: pr.repoName,
				number: pr.number,
				title: pr.title,
				sourceBranch: pr.branchName,
				isDraft: pr.isDraft,
			});
	for (const pr of input.bitbucket ?? [])
		if (pr.state.toLowerCase() === "open")
			add({
				provider: "bitbucket",
				owner: pr.workspace,
				repo: pr.repoSlug,
				number: pr.id,
				title: pr.title,
				sourceBranch: pr.source?.branch?.name ?? "",
				targetBranch: pr.destination?.branch?.name,
				headCommitSha: pr.headCommitSha,
				author: pr.author,
				updatedAt: pr.updatedOn,
			});
	return rows;
}
export function filterReviewSidebarRows(
	rows: readonly ReviewQueuePR[],
	filters: Pick<ReviewSidebarFilters, "search" | "repository">
): ReviewQueuePR[] {
	const query = filters.search.trim().toLocaleLowerCase();
	return rows.filter(
		(pr) =>
			(!filters.repository || `${pr.provider}:${pr.owner}/${pr.repo}` === filters.repository) &&
			(!query ||
				`${pr.title} ${pr.owner}/${pr.repo} #${pr.number} ${pr.author ?? ""}`
					.toLocaleLowerCase()
					.includes(query))
	);
}
