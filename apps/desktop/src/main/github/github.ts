import { githubFetch } from "./auth";

// ── Public types ──────────────────────────────────────────────────────────────

export interface GitHubPR {
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

// ── API helpers ───────────────────────────────────────────────────────────────

async function searchPRs(query: string): Promise<RawSearchIssueNode[]> {
	const allItems: RawSearchIssueNode[] = [];
	let page = 1;

	while (true) {
		const res = await githubFetch(
			`/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`
		);
		if (!res.ok) throw new Error(`GitHub search failed: ${res.status} ${await res.text()}`);
		const data = (await res.json()) as {
			items: RawSearchIssueNode[];
			total_count: number;
		};
		allItems.push(...data.items);
		if (allItems.length >= data.total_count || data.items.length < 100) break;
		page++;
	}

	return allItems;
}

// ── Public API functions ──────────────────────────────────────────────────────

export async function getMyPRs(): Promise<GitHubPR[]> {
	const [authoredNodes, reviewingNodes] = await Promise.all([
		searchPRs("is:pr is:open author:@me"),
		searchPRs("is:pr is:open review-requested:@me"),
	]);

	const seen = new Set<number>();
	const nodes: { node: RawSearchIssueNode; role: "author" | "reviewer" }[] = [];

	for (const node of authoredNodes) {
		seen.add(node.id);
		nodes.push({ node, role: "author" });
	}

	for (const node of reviewingNodes) {
		if (!seen.has(node.id)) {
			nodes.push({ node, role: "reviewer" });
		}
	}

	// Fetch full PR details to get branch names (head.ref)
	const result = await Promise.all(
		nodes.map(async ({ node, role }) => {
			let branchName = "unknown";
			if (node.pull_request?.url) {
				try {
					const prRes = await githubFetch(node.pull_request.url.replace("https://api.github.com", ""));
					if (prRes.ok) {
						const prData = (await prRes.json()) as { head: { ref: string } };
						branchName = prData.head.ref;
					}
				} catch (err) {
					console.error(`Failed to fetch branch name for PR #${node.number}:`, err);
				}
			}
			return mapPRNode(node, role, branchName);
		})
	);

	return result;
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
