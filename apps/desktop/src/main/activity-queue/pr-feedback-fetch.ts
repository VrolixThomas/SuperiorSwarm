import { atlassianFetch } from "../atlassian/auth";
import { githubFetch, githubGraphQL } from "../github/auth";
import type { PRFeedbackEvent } from "./pr-feedback";
export async function githubPages<T>(path: string): Promise<T[]> {
	const rows: T[] = [];
	for (let page = 1; page <= 100; page++) {
		const response = await githubFetch(
			`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`
		);
		if (!response.ok) throw new Error("GitHub activity is unavailable.");
		const data = await response.json();
		if (!Array.isArray(data)) throw new Error("GitHub activity is incomplete.");
		rows.push(...data);
		if (!response.headers.get("link")?.includes('rel="next"')) return rows;
	}
	throw new Error("GitHub activity exceeded the complete-page limit.");
}
export async function fetchPRFeedback(
	provider: "github" | "bitbucket",
	owner: string,
	repo: string,
	number: number
): Promise<PRFeedbackEvent[]> {
	const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
	if (provider === "github") {
		type Comment = {
			id: number;
			body: string;
			user: { id: number; login: string };
			created_at?: string;
			submitted_at?: string;
			state?: string;
		};
		const [comments, reviews] = await Promise.all([
			githubPages<Comment>(`${base}/issues/${number}/comments`),
			githubPages<Comment>(`${base}/pulls/${number}/reviews`),
		]);
		const latestReviews = new Map<number, Comment>();
		for (const review of reviews)
			if (review.submitted_at && review.state !== "PENDING") {
				const old = latestReviews.get(review.user.id);
				if (!old || Date.parse(review.submitted_at) > Date.parse(old.submitted_at ?? ""))
					latestReviews.set(review.user.id, review);
			}
		const result: PRFeedbackEvent[] = [
			...comments.map((e) => ({ ...e, id: `comment:${e.id}` })),
			...[...latestReviews.values()]
				.filter(
					(e) => e.state === "CHANGES_REQUESTED" || (e.state === "COMMENTED" && e.body?.trim())
				)
				.map((e) => ({ ...e, id: `review:${e.id}` })),
		].map((e) => ({
			id: e.id,
			authorId: String(e.user.id),
			author: e.user.login,
			body: e.body || (e.state === "CHANGES_REQUESTED" ? "Requested changes on your PR." : ""),
			at: Date.parse(e.created_at ?? e.submitted_at ?? "") || 0,
		}));
		let cursor: string | null = null;
		for (let page = 0; page < 100; page++) {
			const data: {
				repository: {
					pullRequest: {
						reviewThreads: {
							nodes: {
								id: string;
								isResolved: boolean;
								path?: string;
								line?: number | null;
								comments: {
									nodes: {
										id: string;
										body: string;
										createdAt: string;
										author: { login: string; databaseId?: number } | null;
									}[];
									pageInfo: { hasNextPage: boolean };
								};
							}[];
							pageInfo: { hasNextPage: boolean; endCursor: string | null };
						};
					};
				};
			} = await githubGraphQL(
				"query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id isResolved path line comments(first:100){pageInfo{hasNextPage} nodes{id body createdAt author{login ... on User{databaseId}}}}}}}}}",
				{ owner, repo, number, cursor }
			);
			const threads = data.repository?.pullRequest?.reviewThreads;
			if (!threads) throw new Error("Review threads unavailable.");
			for (const thread of threads.nodes) {
				if (thread.comments.pageInfo.hasNextPage)
					throw new Error("A feedback thread is incomplete.");
				for (const comment of thread.comments.nodes) {
					if (!comment.author?.databaseId) continue;
					result.push({
						id: `thread:${comment.id}`,
						authorId: String(comment.author.databaseId),
						author: comment.author.login,
						body: comment.body,
						at: Date.parse(comment.createdAt) || 0,
						resolved: thread.isResolved,
						filePath: thread.path,
						lineNumber: thread.line,
						threadId: thread.id,
					});
				}
			}
			if (!threads.pageInfo.hasNextPage) return result;
			if (!threads.pageInfo.endCursor || threads.pageInfo.endCursor === cursor)
				throw new Error("Review thread pagination incomplete.");
			cursor = threads.pageInfo.endCursor;
		}
		throw new Error("Review thread limit exceeded.");
	}
	const result: PRFeedbackEvent[] = [];
	const stateResponse = await atlassianFetch(
		"bitbucket",
		`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pullrequests/${number}`
	);
	if (!stateResponse.ok) throw new Error("Bitbucket review state unavailable.");
	const state = (await stateResponse.json()) as {
		participants?: {
			user?: { account_id?: string; display_name?: string };
			state?: string;
			participated_on?: string;
		}[];
	};
	if (!Array.isArray(state.participants))
		throw new Error("Bitbucket review participants incomplete.");
	for (const participant of state.participants)
		if (
			participant.state === "changes_requested" &&
			participant.user?.account_id &&
			participant.participated_on
		)
			result.push({
				id: `review:${participant.user.account_id}:${participant.participated_on}`,
				authorId: participant.user.account_id,
				author: participant.user.display_name ?? participant.user.account_id,
				body: "Requested changes on your PR.",
				at: Date.parse(participant.participated_on) || 0,
			});
	let next: string | undefined =
		`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pullrequests/${number}/comments?pagelen=100`;
	for (let page = 0; next && page < 100; page++) {
		if (!next.startsWith("https://api.bitbucket.org/2.0/"))
			throw new Error("Unexpected activity pagination host.");
		const response = await atlassianFetch("bitbucket", next);
		if (!response.ok) throw new Error("Bitbucket feedback unavailable.");
		const data = (await response.json()) as {
			values: {
				id: number;
				deleted?: boolean;
				content: { raw: string };
				user: { account_id: string; display_name: string };
				created_on: string;
			}[];
			next?: string;
		};
		if (!Array.isArray(data.values)) throw new Error("Bitbucket feedback incomplete.");
		for (const e of data.values)
			if (e.user?.account_id)
				result.push({
					id: `comment:${e.id}`,
					authorId: e.user.account_id,
					author: e.user.display_name,
					body: e.content?.raw ?? "",
					at: Date.parse(e.created_on) || 0,
					resolved: e.deleted,
					threadId: String(e.id),
				});
		next = data.next;
	}
	if (next) throw new Error("Bitbucket feedback limit exceeded.");
	return result;
}
