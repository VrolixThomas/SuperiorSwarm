import { atlassianFetch, getAuth } from "../atlassian/auth";
import {
	type BitbucketComment,
	type BitbucketPullRequest,
	createPRComment,
	getBitbucketPRComments,
	getMyPullRequests,
	getPRState,
	getReviewRequests,
	replyToPRComment,
} from "../atlassian/bitbucket";
import { BITBUCKET_API_BASE } from "../atlassian/constants";
import type {
	CreateCommentParams,
	GitProvider,
	NormalizedComment,
	NormalizedPR,
	NormalizedPRFile,
	NormalizedReviewThread,
	PRState,
	ReplyParams,
	ResolveParams,
	SubmitReviewParams,
} from "./types";

// ── Pure mapping helpers (exported for testing) ───────────────────────────────

export function normalizeBBState(state: string): "open" | "closed" | "merged" | "declined" {
	switch (state?.toUpperCase()) {
		case "OPEN":
			return "open";
		case "MERGED":
			return "merged";
		case "DECLINED":
			return "declined";
		default:
			return "closed";
	}
}

export function mapBitbucketPR(
	pr: BitbucketPullRequest,
	role: "author" | "reviewer"
): NormalizedPR {
	return {
		id: pr.id,
		title: pr.title,
		state: normalizeBBState(pr.state),
		author: pr.author,
		webUrl: pr.webUrl,
		sourceBranch: pr.source?.branch?.name ?? "",
		targetBranch: pr.destination?.branch?.name ?? "",
		role,
		repoOwner: pr.workspace,
		repoName: pr.repoSlug,
	};
}

export function mapBitbucketComment(comment: BitbucketComment): NormalizedComment {
	return {
		id: String(comment.id),
		body: comment.body,
		author: comment.author,
		filePath: comment.filePath,
		lineNumber: comment.lineNumber,
		createdAt: comment.createdAt,
	};
}

// ── BitbucketAdapter ──────────────────────────────────────────────────────────

export class BitbucketAdapter implements GitProvider {
	readonly name = "bitbucket" as const;

	isConnected(): boolean {
		return getAuth("bitbucket") !== null;
	}

	async getMyPRs(): Promise<NormalizedPR[]> {
		const [authored, reviewing] = await Promise.all([getMyPullRequests(), getReviewRequests()]);

		const seen = new Set<number>();
		const results: NormalizedPR[] = [];

		for (const pr of authored) {
			seen.add(pr.id);
			results.push(mapBitbucketPR(pr, "author"));
		}

		for (const pr of reviewing) {
			if (!seen.has(pr.id)) {
				results.push(mapBitbucketPR(pr, "reviewer"));
			}
		}

		return results;
	}

	async getPRState(owner: string, repo: string, prNumber: number): Promise<PRState> {
		const { headSha, state } = await getPRState(owner, repo, prNumber);
		return { headSha, state: normalizeBBState(state) };
	}

	async getPRComments(owner: string, repo: string, prNumber: number): Promise<NormalizedComment[]> {
		const comments = await getBitbucketPRComments(owner, repo, prNumber);
		return comments.map(mapBitbucketComment);
	}

	async createInlineComment(params: CreateCommentParams): Promise<{ id: string; nodeId?: string }> {
		const { id } = await createPRComment(
			params.owner,
			params.repo,
			params.prNumber,
			params.body,
			params.filePath,
			params.line
		);
		return { id: String(id) };
	}

	async replyToComment(params: ReplyParams): Promise<{ id: string }> {
		const { id } = await replyToPRComment(
			params.owner,
			params.repo,
			params.prNumber,
			Number(params.commentId),
			params.body
		);
		return { id: String(id) };
	}

	async resolveComment(params: ResolveParams): Promise<void> {
		const res = await atlassianFetch(
			"bitbucket",
			`${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}/comments/${params.commentId}/resolve`,
			{ method: "POST" }
		);
		if (!res.ok && res.status !== 409) {
			throw new Error(`Bitbucket resolve comment failed: ${res.status}`);
		}
	}

	async unresolveComment(params: ResolveParams): Promise<void> {
		const res = await atlassianFetch(
			"bitbucket",
			`${BITBUCKET_API_BASE}/repositories/${params.owner}/${params.repo}/pullrequests/${params.prNumber}/comments/${params.commentId}/resolve`,
			{ method: "DELETE" }
		);
		if (!res.ok && res.status !== 409) {
			throw new Error(`Bitbucket unresolve comment failed: ${res.status}`);
		}
	}

	async submitReview(_params: SubmitReviewParams): Promise<void> {
		// Bitbucket doesn't have a formal review submission API like GitHub.
		// Comments are posted inline; no-op here.
	}

	async getPRFiles(owner: string, repo: string, prNumber: number): Promise<NormalizedPRFile[]> {
		const res = await atlassianFetch(
			"bitbucket",
			`${BITBUCKET_API_BASE}/repositories/${owner}/${repo}/pullrequests/${prNumber}/diffstat`
		);
		if (!res.ok) return [];
		const data = (await res.json()) as {
			values: Array<{ new?: { path: string }; old?: { path: string }; status: string }>;
		};
		return data.values.map((f) => ({
			path: f.new?.path ?? f.old?.path ?? "",
			status:
				f.status === "added" ? ("added" as const)
				: f.status === "removed" ? ("removed" as const)
				: f.status === "renamed" ? ("renamed" as const)
				: ("modified" as const),
			previousPath: f.status === "renamed" ? f.old?.path : undefined,
		}));
	}

	async getReviewThreads(): Promise<NormalizedReviewThread[]> {
		// Bitbucket comments don't have thread resolution state via API.
		return [];
	}
}
