import type { GitHubPREnriched } from "../../shared/github-types";
import {
	type GitHubCompactPR,
	type PRActivityFacts,
	githubActivity,
} from "../providers/pr-activity";
import { getAuth, githubFetch, githubGraphQL } from "./auth";

// ── Public types ──────────────────────────────────────────────────────────────

export interface GitHubPR {
	activity?: PRActivityFacts;
	id: number;
	number: number;
	title: string;
	url: string;
	branchName: string;
	state: "open" | "closed";
	isDraft: boolean;
	repoOwner: string;
	repoName: string;
	role: "author" | "reviewer";
	reviewDecision: "approved" | "changes_requested" | "review_required" | null;
	commentCount: number;
}

export interface GitHubComment {
	id: number;
	body: string;
	author: string;
	createdAt: string;
	kind: "issue" | "review";
	path?: string;
	line?: number;
}

// ── Raw API node types ────────────────────────────────────────────────────────

interface RawSearchIssueNode {
	id: number;
	number: number;
	title: string;
	html_url: string;
	state: "open" | "closed";
	draft: boolean;
	comments: number;
	pull_request?: { url: string; review_comments: number };
	repository_url: string;
}

interface RawCommentNode {
	id: number;
	body: string;
	user: { login: string };
	created_at: string;
	path?: string;
	line?: number;
}

// ── Pure mapping functions (exported for testing) ─────────────────────────────

export function mapPRNode(
	node: RawSearchIssueNode,
	role: "author" | "reviewer",
	branchName: string
): GitHubPR {
	// repository_url is like "https://api.github.com/repos/owner/name"
	const parts = node.repository_url.split("/");
	const repoName = parts[parts.length - 1] ?? "";
	const repoOwner = parts[parts.length - 2] ?? "";

	return {
		id: node.id,
		number: node.number,
		title: node.title,
		url: node.html_url,
		branchName,
		state: node.state,
		isDraft: node.draft,
		repoOwner,
		repoName,
		role,
		reviewDecision: null, // search API doesn't return review decision; null for now
		commentCount: node.comments + (node.pull_request?.review_comments ?? 0),
	};
}

export function mapCommentNode(node: RawCommentNode, kind: "issue" | "review"): GitHubComment {
	return {
		id: node.id,
		body: node.body,
		author: node.user.login,
		createdAt: node.created_at,
		kind,
		path: node.path,
		line: node.line,
	};
}

// ── GraphQL raw types ─────────────────────────────────────────────────────────

interface RawGQLCheckContext {
	__typename: "CheckRun" | "StatusContext";
	name?: string;
	context?: string;
	status?: string;
	conclusion?: string | null;
	detailsUrl?: string | null;
	state?: string;
	targetUrl?: string | null;
}

interface RawGQLThread {
	id: string;
	isResolved: boolean;
	path: string;
	line: number | null;
	diffSide: "LEFT" | "RIGHT";
	comments: {
		nodes: {
			id: string;
			body: string;
			author: { login: string; avatarUrl: string };
			createdAt: string;
		}[];
	};
}

interface RawGQLPR {
	title: string;
	body: string;
	state: string;
	isDraft: boolean;
	author: { login: string; avatarUrl: string };
	reviewDecision: string | null;
	commits: {
		nodes: {
			commit: {
				oid: string;
				statusCheckRollup: {
					state: string;
					contexts: { nodes: RawGQLCheckContext[] };
				} | null;
			};
		}[];
	};
	reviewRequests: { nodes: { requestedReviewer?: { login: string; avatarUrl: string } }[] };
	reviews: { nodes: { author: { login: string; avatarUrl: string }; state: string }[] };
	reviewThreads: { nodes: RawGQLThread[] };
	comments: {
		nodes: {
			id: string;
			body: string;
			author: { login: string; avatarUrl: string };
			createdAt: string;
		}[];
	};
	files: { nodes: { path: string; additions: number; deletions: number; changeType: string }[] };
	headRefName: string;
	baseRefName: string;
}

// ── Mapping ───────────────────────────────────────────────────────────────────

export function mapPRDetails(raw: RawGQLPR): import("../../shared/github-types").GitHubPRDetails {
	const headCommit = raw.commits.nodes[0]?.commit;
	const rollup = headCommit?.statusCheckRollup ?? null;
	const checks = (rollup?.contexts.nodes ?? []).map((c) => ({
		name: c.name ?? c.context ?? "",
		status: c.status ?? c.state ?? "",
		conclusion: c.conclusion ?? null,
		detailsUrl: c.detailsUrl ?? c.targetUrl ?? null,
	}));

	// Build reviewer map: merge review requests with submitted reviews
	const reviewerMap = new Map<string, import("../../shared/github-types").GitHubReviewer>();
	for (const req of raw.reviewRequests.nodes) {
		const r = req.requestedReviewer;
		if (r)
			reviewerMap.set(r.login, { login: r.login, avatarUrl: r.avatarUrl, decision: "PENDING" });
	}
	for (const rev of raw.reviews.nodes) {
		const existing = reviewerMap.get(rev.author.login);
		const decision = rev.state as import("../../shared/github-types").GitHubReviewer["decision"];
		if (existing) {
			existing.decision = decision;
		} else {
			reviewerMap.set(rev.author.login, {
				login: rev.author.login,
				avatarUrl: rev.author.avatarUrl,
				decision,
			});
		}
	}

	return {
		title: raw.title,
		body: raw.body,
		state: raw.state as "OPEN" | "CLOSED" | "MERGED",
		isDraft: raw.isDraft,
		author: raw.author.login,
		authorAvatarUrl: raw.author.avatarUrl,
		reviewDecision: raw.reviewDecision as import(
			"../../shared/github-types"
		).GitHubPRDetails["reviewDecision"],
		ciState: rollup
			? (rollup.state as import("../../shared/github-types").GitHubPRDetails["ciState"])
			: null,
		checks,
		reviewers: [...reviewerMap.values()],
		reviewThreads: raw.reviewThreads.nodes.map((t) => ({
			id: t.id,
			isResolved: t.isResolved,
			path: t.path,
			line: t.line,
			diffSide: t.diffSide,
			comments: t.comments.nodes.map((c) => ({
				id: c.id,
				body: c.body,
				author: c.author.login,
				authorAvatarUrl: c.author.avatarUrl,
				createdAt: c.createdAt,
			})),
		})),
		conversationComments: raw.comments.nodes.map((c) => ({
			id: c.id,
			body: c.body,
			author: c.author.login,
			authorAvatarUrl: c.author.avatarUrl,
			createdAt: c.createdAt,
		})),
		files: raw.files.nodes.map((f) => ({
			path: f.path,
			additions: f.additions,
			deletions: f.deletions,
			changeType: f.changeType as import("../../shared/github-types").GitHubPRFile["changeType"],
		})),
		sourceBranch: raw.headRefName,
		targetBranch: raw.baseRefName,
		headCommitOid: headCommit?.oid ?? "",
	};
}

// ── API helpers ───────────────────────────────────────────────────────────────

/**
 * Walk a GitHub Search API result set page-by-page until either the
 * fetcher reports no next page or we hit the 10-page hard cap (1 000-result
 * limit imposed by GitHub for the search API — see SUP-19 for the longer
 * follow-up).
 *
 * The fetcher callback is the only impure part — given a 1-indexed page
 * number it returns the items and a `hasNext` flag derived from the
 * response's `Link` header. Strict failure: if any page throws, the whole
 * call throws.
 */
export async function paginateGitHubSearch<T>(
	fetchPage: (page: number) => Promise<{ items: T[]; hasNext: boolean }>
): Promise<T[]> {
	const HARD_CAP_PAGES = 10;
	const all: T[] = [];
	for (let page = 1; page <= HARD_CAP_PAGES; page++) {
		const { items, hasNext } = await fetchPage(page);
		for (const item of items) all.push(item);
		if (!hasNext) return all;
	}
	console.warn("[github] paginateGitHubSearch hit 1000-result cap (10 pages × 100); see SUP-19");
	return all;
}

async function searchPRs(query: string): Promise<RawSearchIssueNode[]> {
	return paginateGitHubSearch<RawSearchIssueNode>(async (page) => {
		const res = await githubFetch(
			`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`
		);
		if (!res.ok) {
			throw new Error(`GitHub search failed: ${res.status} ${res.statusText}`);
		}
		const data = (await res.json()) as { items: RawSearchIssueNode[] };
		const linkHeader = res.headers.get("Link") ?? "";
		const hasNext = /rel="next"/.test(linkHeader);
		return { items: data.items, hasNext };
	});
}

// ── Public API functions ──────────────────────────────────────────────────────

const COMPACT_PR_FIELDS = `headRefName baseRefName headRefOid isDraft state author { ... on User { databaseId } ... on Bot { databaseId } }
 reviewRequests(first: 100) { pageInfo { hasNextPage } nodes { requestedReviewer { ... on User { login } ... on Team { slug organization { login } } } } }
 reviews(last: 100) { totalCount nodes { id state submittedAt author { login } commit { oid } } }
 comments(last: 1) { totalCount nodes { id updatedAt } }`;

async function fetchCompactPRs(
	nodes: { node: RawSearchIssueNode }[]
): Promise<Map<string, GitHubCompactPR>> {
	const result = new Map<string, GitHubCompactPR>();
	// Bounded aliases; an unavailable batch leaves its facts unknown.
	for (let start = 0; start < nodes.length; start += 25) {
		const batch = nodes.slice(start, start + 25);
		const aliases = batch.map(({ node }, i) => {
			const parts = node.repository_url.split("/");
			return `pr${i}: repository(owner: ${JSON.stringify(parts.at(-2))}, name: ${JSON.stringify(parts.at(-1))}) { pullRequest(number: ${node.number}) { ${COMPACT_PR_FIELDS} } }`;
		});
		try {
			const data = await githubGraphQL<
				Record<string, { pullRequest: GitHubCompactPR | null } | null>
			>(`{ ${aliases.join("\n")} }`, {});
			batch.forEach(({ node }, i) => {
				const pr = data[`pr${i}`]?.pullRequest;
				if (pr) result.set(`${node.repository_url}#${node.number}`, pr);
			});
		} catch (error) {
			console.error("[github] Compact PR batch unavailable", error);
		}
	}
	return result;
}

async function getReviewIdentity(): Promise<{ login?: string; teams?: string[] }> {
	const result: { login?: string; teams?: string[] } = {};
	try {
		const res = await githubFetch("/user");
		if (res.ok) result.login = ((await res.json()) as { login: string }).login;
	} catch {
		/* unknown */
	}
	try {
		const res = await githubFetch("/user/teams?per_page=100");
		if (res.ok && !res.headers.get("link")?.includes('rel="next"')) {
			result.teams = (
				(await res.json()) as { slug: string; organization: { login: string } }[]
			).map((t) => `${t.organization.login}/${t.slug}`);
		}
	} catch {
		/* incomplete team membership cannot prove request removal */
	}
	return result;
}

export async function getMyPRs(): Promise<GitHubPR[]> {
	const accountId = getAuth()?.accountId;
	const identity = await getReviewIdentity();
	const username = identity.login ?? "@me";
	const teamSlugs = identity.teams ?? [];

	const searches: Promise<RawSearchIssueNode[]>[] = [
		searchPRs("is:pr is:open author:@me"),
		searchPRs(`is:pr is:open review-requested:${username}`),
		searchPRs(`is:pr is:open reviewed-by:${username} -author:${username}`),
	];

	// Add team-based review request searches
	for (const slug of teamSlugs) {
		searches.push(searchPRs(`is:pr is:open team-review-requested:${slug}`));
	}

	const [authoredNodes = [], reviewRequestedNodes = [], reviewedByNodes = [], ...teamNodes] =
		await Promise.all(searches);

	const seen = new Set<number>();
	const nodes: { node: RawSearchIssueNode; role: "author" | "reviewer" }[] = [];

	for (const node of authoredNodes) {
		seen.add(node.id);
		nodes.push({ node, role: "author" });
	}

	const allReviewerNodes = [...reviewRequestedNodes, ...reviewedByNodes, ...teamNodes.flat()];
	for (const node of allReviewerNodes) {
		if (!seen.has(node.id)) {
			seen.add(node.id);
			nodes.push({ node, role: "reviewer" });
		}
	}

	const compact = await fetchCompactPRs(nodes);
	return nodes.map(({ node, role }) => {
		const raw = compact.get(`${node.repository_url}#${node.number}`);
		const pr = mapPRNode(node, role, raw?.headRefName ?? "unknown");
		pr.activity = raw
			? { ...githubActivity(raw, identity.login, identity.teams), accountId }
			: { accountId };
		return pr;
	});
}

export async function getPRComments(
	owner: string,
	repo: string,
	number: number
): Promise<GitHubComment[]> {
	const [issueRes, reviewRes] = await Promise.all([
		githubFetch(`/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`),
		githubFetch(`/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`),
	]);

	if (!issueRes.ok) throw new Error(`GitHub issue comments failed: ${issueRes.status}`);
	if (!reviewRes.ok) throw new Error(`GitHub review comments failed: ${reviewRes.status}`);

	const [issueComments, reviewComments] = await Promise.all([
		issueRes.json() as Promise<RawCommentNode[]>,
		reviewRes.json() as Promise<RawCommentNode[]>,
	]);

	const all: GitHubComment[] = [
		...issueComments.map((c) => mapCommentNode(c, "issue")),
		...reviewComments.map((c) => mapCommentNode(c, "review")),
	];

	return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const PR_DETAILS_QUERY = `
  query GetPRDetails($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        title body state isDraft
        author { login avatarUrl }
        reviewDecision
        headRefName baseRefName
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 30) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
        reviewRequests(first: 20) {
          nodes { requestedReviewer { ... on User { login avatarUrl } } }
        }
        reviews(first: 50, states: [APPROVED, CHANGES_REQUESTED, COMMENTED]) {
          nodes { author { login avatarUrl } state }
        }
        reviewThreads(first: 100) {
          nodes {
            id isResolved path line diffSide
            comments(first: 30) {
              nodes { id body author { login avatarUrl } createdAt }
            }
          }
        }
        comments(first: 100) {
          nodes { id body author { login avatarUrl } createdAt }
        }
        files(first: 100) {
          nodes { path additions deletions changeType }
        }
      }
    }
  }
`;

export async function getPRDetails(
	owner: string,
	repo: string,
	number: number
): Promise<import("../../shared/github-types").GitHubPRDetails> {
	const data = await githubGraphQL<{ repository: { pullRequest: RawGQLPR } }>(PR_DETAILS_QUERY, {
		owner,
		repo,
		number,
	});
	return mapPRDetails(data.repository.pullRequest);
}

export async function getPRListEnrichment(
	prs: Array<{ owner: string; repo: string; number: number }>
): Promise<GitHubPREnriched[]> {
	const results: GitHubPREnriched[] = [];
	const batches: Array<Array<(typeof prs)[number]>> = [];
	for (let i = 0; i < prs.length; i += 5) {
		batches.push(prs.slice(i, i + 5));
	}

	for (const batch of batches) {
		const settled = await Promise.allSettled(
			batch.map(async (pr) => {
				const details = await getPRDetails(pr.owner, pr.repo, pr.number);
				if (!details) return null;

				const unresolvedThreadCount = details.reviewThreads.filter((t) => !t.isResolved).length;
				const fileStats = details.files.reduce(
					(acc, f) => ({
						additions: acc.additions + f.additions,
						deletions: acc.deletions + f.deletions,
						count: acc.count + 1,
					}),
					{ additions: 0, deletions: 0, count: 0 }
				);

				return {
					owner: pr.owner,
					repo: pr.repo,
					number: pr.number,
					author: details.author,
					authorAvatarUrl: details.authorAvatarUrl,
					reviewers: details.reviewers,
					ciState: details.ciState,
					reviewDecision: details.reviewDecision,
					unresolvedThreadCount,
					files: fileStats,
					headCommitOid: details.headCommitOid,
					mergeable: "UNKNOWN" as const,
					isDraft: details.isDraft,
					updatedAt: new Date().toISOString(),
				} satisfies GitHubPREnriched;
			})
		);

		for (const result of settled) {
			if (result.status === "fulfilled" && result.value) {
				results.push(result.value);
			}
		}
	}

	return results;
}

export async function createReviewThread(params: {
	owner: string;
	repo: string;
	prNumber: number;
	body: string;
	commitId: string;
	path: string;
	line?: number;
	side?: "LEFT" | "RIGHT";
}): Promise<{ id: number; nodeId: string }> {
	const payload: Record<string, unknown> = {
		body: params.body,
		commit_id: params.commitId,
		path: params.path,
	};

	if (params.line != null) {
		payload["line"] = params.line;
		payload["side"] = params.side ?? "RIGHT";
	} else {
		payload["subject_type"] = "file";
	}

	const res = await githubFetch(
		`/repos/${params.owner}/${params.repo}/pulls/${params.prNumber}/comments`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		}
	);
	if (!res.ok) throw new Error(`GitHub create thread failed: ${res.status} ${await res.text()}`);
	const data = (await res.json()) as { id: number; node_id: string };
	return { id: data.id, nodeId: data.node_id };
}

export async function addReviewThreadReply(params: {
	threadId: string;
	body: string;
}): Promise<{ id: string }> {
	const mutation = `
    mutation AddReviewThreadReply($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
        comment { id body }
      }
    }
  `;
	const data = await githubGraphQL<{
		addPullRequestReviewThreadReply: { comment: { id: string } };
	}>(mutation, { threadId: params.threadId, body: params.body });
	return { id: data.addPullRequestReviewThreadReply.comment.id };
}

export async function submitReview(params: {
	owner: string;
	repo: string;
	prNumber: number;
	verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
	body: string;
}): Promise<void> {
	const res = await githubFetch(
		`/repos/${params.owner}/${params.repo}/pulls/${params.prNumber}/reviews`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				event: params.verdict,
				body: params.body,
			}),
		}
	);
	if (!res.ok) throw new Error(`GitHub submit review failed: ${res.status} ${await res.text()}`);
}

export async function resolveThread(threadId: string): Promise<void> {
	const mutation = `
    mutation ResolveReviewThread($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }
  `;
	await githubGraphQL<unknown>(mutation, { threadId });
}

export async function unresolveThread(threadId: string): Promise<void> {
	const mutation = `
    mutation UnresolveReviewThread($threadId: ID!) {
      unresolveReviewThread(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }
  `;
	await githubGraphQL<unknown>(mutation, { threadId });
}

export interface PRFileInfo {
	path: string;
	status: "added" | "modified" | "removed" | "renamed";
	previousPath?: string;
}

/** Get PR files with rename detection via REST API */
export async function getPRFiles(
	owner: string,
	repo: string,
	prNumber: number
): Promise<PRFileInfo[]> {
	const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);
	if (!res.ok) throw new Error(`GitHub get PR files failed: ${res.status}`);
	const data = (await res.json()) as Array<{
		filename: string;
		status: string;
		previous_filename?: string;
	}>;
	return data.map((f) => ({
		path: f.filename,
		status: f.status as PRFileInfo["status"],
		previousPath: f.previous_filename,
	}));
}

export async function getPRState(
	owner: string,
	repo: string,
	prNumber: number
): Promise<{ headSha: string; state: string; merged: boolean; activity: PRActivityFacts }> {
	const accountId = getAuth()?.accountId;
	const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`);
	if (!res.ok) throw new Error(`GitHub get PR failed: ${res.status}`);
	const data = (await res.json()) as { head: { sha: string }; state: string; merged: boolean };
	const activity: PRActivityFacts = {
		accountId,
		headSha: data.head?.sha,
		state: data.merged
			? "merged"
			: data.state === "open"
				? "open"
				: data.state === "closed"
					? "closed"
					: undefined,
	};
	if (!activity.state) throw new Error("GitHub PR state missing");
	// Only disappearance/enrichment checks use this path, not every listed PR.
	try {
		const identity = await getReviewIdentity();
		const raw = await githubGraphQL<{ repository: { pullRequest: GitHubCompactPR | null } | null }>(
			`query($owner:String!, $repo:String!, $number:Int!) { repository(owner:$owner, name:$repo) { pullRequest(number:$number) { ${COMPACT_PR_FIELDS} } } }`,
			{ owner, repo, number: prNumber }
		);
		if (raw.repository?.pullRequest)
			Object.assign(
				activity,
				githubActivity(raw.repository.pullRequest, identity.login, identity.teams)
			);
	} catch {
		/* preserve confirmed REST state/head; other facts remain unknown */
	}
	return { headSha: data.head?.sha ?? "", state: data.state, merged: data.merged, activity };
}

export async function getGitHubReviewThreads(
	owner: string,
	repo: string,
	prNumber: number
): Promise<Array<{ nodeId: string; isResolved: boolean }>> {
	const query = `
    query GetReviewThreads($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes { id }
              }
            }
          }
        }
      }
    }
  `;
	const data = await githubGraphQL<{
		repository: {
			pullRequest: {
				reviewThreads: {
					nodes: Array<{
						id: string;
						isResolved: boolean;
						comments: { nodes: Array<{ id: string }> };
					}>;
				};
			};
		};
	}>(query, { owner, repo, prNumber });

	return data.repository.pullRequest.reviewThreads.nodes.map((t) => ({
		nodeId: t.id,
		isResolved: t.isResolved,
	}));
}
