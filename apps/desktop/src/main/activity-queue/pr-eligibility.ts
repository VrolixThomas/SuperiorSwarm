import { type QueuePRReviewEvidence, evaluateQueuePRReview } from "../../shared/queue-pr";
import { githubFetch, githubGraphQL } from "../github/auth";
import { githubPages } from "./pr-feedback-fetch";
export async function fetchQueuePRReviewEvidence(
	owner: string,
	repo: string,
	number: number,
	viewerId: string
) {
	const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
	type Review = {
		id: number;
		user: { id: number };
		state: string;
		commit_id: string;
		submitted_at: string;
	};
	const reviews = await githubPages<Review>(`${base}/pulls/${number}/reviews`);
	const review = reviews
		.filter((r) => String(r.user.id) === viewerId && r.submitted_at && r.state !== "PENDING")
		.sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at))[0];
	type Thread = {
		isResolved: boolean;
		path: string;
		comments: {
			nodes: {
				author: { databaseId: number } | null;
				pullRequestReview: { databaseId: number } | null;
			}[];
		};
	};
	const data = await githubGraphQL<{
		repository: {
			pullRequest: {
				headRefOid: string;
				state: string;
				isDraft: boolean;
				reviewThreads: { nodes: Thread[]; pageInfo: { hasNextPage: boolean } };
				commits: {
					nodes: {
						commit: {
							statusCheckRollup: {
								state: string;
								contexts: {
									totalCount: number;
									pageInfo: { hasNextPage: boolean };
									nodes: {
										__typename: string;
										status?: string;
										conclusion?: string;
										state?: string;
									}[];
								};
							} | null;
						};
					}[];
				};
			};
		};
	}>(
		"query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid state isDraft reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path comments(first:1){nodes{author{... on User{databaseId}} pullRequestReview{databaseId}}}}} commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100){totalCount pageInfo{hasNextPage} nodes{__typename ... on CheckRun{status conclusion} ... on StatusContext{state}}}}}}}}}}",
		{ owner, repo, number }
	);
	const pr = data.repository?.pullRequest;
	if (!pr?.headRefOid) throw new Error("Current review head is unavailable.");
	const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup;
	const value: QueuePRReviewEvidence = {
		headSha: pr.headRefOid,
		viewerId,
		reviewId: review ? String(review.id) : undefined,
		reviewedSha: review?.commit_id,
		reviewState: review?.state,
		threadsComplete:
			!pr.reviewThreads.pageInfo.hasNextPage &&
			pr.reviewThreads.nodes.every((t) => t.comments.nodes.length === 1),
		ownThreads: pr.reviewThreads.nodes
			.filter(
				(t) =>
					String(t.comments.nodes[0]?.author?.databaseId) === viewerId &&
					String(t.comments.nodes[0]?.pullRequestReview?.databaseId) === String(review?.id)
			)
			.map((t) => ({ path: t.path, resolved: t.isResolved })),
		comparison: "unknown",
		filesComplete: false,
		changedFiles: [],
		ciComplete:
			!!rollup &&
			!rollup.contexts.pageInfo.hasNextPage &&
			rollup.contexts.totalCount > 0 &&
			rollup.contexts.nodes.length === rollup.contexts.totalCount,
		ciPassing:
			!!rollup &&
			rollup.state === "SUCCESS" &&
			rollup.contexts.nodes.every((c) =>
				c.__typename === "CheckRun"
					? c.status === "COMPLETED" && c.conclusion === "SUCCESS"
					: c.state === "SUCCESS"
			),
		open: pr.state === "OPEN",
		draft: pr.isDraft,
	};
	if (review?.commit_id) {
		const response = await githubFetch(
			`${base}/compare/${encodeURIComponent(review.commit_id)}...${encodeURIComponent(pr.headRefOid)}?per_page=100`
		);
		if (response.ok) {
			const compare = (await response.json()) as {
				status: string;
				merge_base_commit?: { sha: string };
				files?: { filename: string; previous_filename?: string }[];
				total_commits: number;
			};
			value.comparison = ["ahead", "identical", "diverged", "behind"].includes(compare.status)
				? (compare.status as QueuePRReviewEvidence["comparison"])
				: "unknown";
			value.comparisonBase = compare.merge_base_commit?.sha;
			// GitHub comparison files are capped at 300. Exactly 300 cannot prove completeness.
			value.filesComplete = Array.isArray(compare.files) && compare.files.length < 300;
			value.changedFiles = [
				...new Set(
					compare.files?.flatMap((f) =>
						f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]
					) ?? []
				),
			];
		}
	}
	return { ...evaluateQueuePRReview(value), facts: value };
}
