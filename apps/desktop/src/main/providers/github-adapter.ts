import type { GitHubPRDetails } from "../../shared/github-types";
import { getValidToken, githubFetch } from "../github/auth";
import {
	addReviewThreadReply,
	createReviewThread,
	getPRDetails as getGitHubPRDetails,
	getGitHubReviewThreads,
	getMyPRs,
	getPRComments,
	getPRFiles,
	getPRState,
	resolveThread,
	submitReview,
	unresolveThread,
} from "../github/github";
import { joinCacheKey, splitCacheKey } from "./github-cache-key";
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

export { joinCacheKey, splitCacheKey };

export class GitHubAdapter implements GitProvider {
	readonly name = "github" as const;

	isConnected(): boolean {
		return getValidToken() !== null;
	}

	async getMyPRs(): Promise<NormalizedPR[]> {
		const prs = await getMyPRs();
		return prs.map((pr) => ({
			id: pr.number,
			title: pr.title ?? "",
			state: pr.state === "open" ? ("open" as const) : ("closed" as const),
			author: pr.repoOwner ?? "Unknown",
			webUrl: pr.url ?? "",
			sourceBranch: pr.branchName ?? "",
			targetBranch: "",
			role: pr.role ?? "author",
			repoOwner: pr.repoOwner ?? "",
			repoName: pr.repoName ?? "",
			headCommitSha: "",
		}));
	}

	async getPRState(owner: string, repo: string, prNumber: number): Promise<PRState> {
		const result = await getPRState(owner, repo, prNumber);
		return {
			headSha: result.headSha ?? "",
			state: result.merged ? "merged" : result.state === "open" ? "open" : "closed",
		};
	}

	async getPRComments(owner: string, repo: string, prNumber: number): Promise<NormalizedComment[]> {
		const comments = await getPRComments(owner, repo, prNumber);
		return comments.map((c) => ({
			id: String(c.id),
			body: c.body ?? "",
			author: c.author ?? "Unknown",
			filePath: c.path ?? null,
			lineNumber: c.line ?? null,
			side: null,
			createdAt: c.createdAt ?? "",
		}));
	}

	async getPRCommentsIfChanged(
		owner: string,
		repo: string,
		prNumber: number,
		cacheKey?: string
	): Promise<
		{ changed: true; comments: NormalizedComment[]; cacheKey: string } | { changed: false }
	> {
		const [issueEtag, reviewEtag] = cacheKey ? splitCacheKey(cacheKey) : [undefined, undefined];

		const [issueRes, reviewRes] = await Promise.all([
			githubFetch(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, {
				headers: issueEtag ? { "If-None-Match": issueEtag } : {},
			}),
			githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`, {
				headers: reviewEtag ? { "If-None-Match": reviewEtag } : {},
			}),
		]);

		if (issueRes.status === 304 && reviewRes.status === 304) {
			return { changed: false };
		}

		if (!issueRes.ok && issueRes.status !== 304) {
			throw new Error(`GitHub issue comments failed: ${issueRes.status}`);
		}
		if (!reviewRes.ok && reviewRes.status !== 304) {
			throw new Error(`GitHub review comments failed: ${reviewRes.status}`);
		}

		interface RawCommentNode {
			id: number;
			body: string;
			user: { login: string };
			created_at: string;
			path?: string;
			line?: number;
			side?: "LEFT" | "RIGHT";
		}

		// One or both returned 200 — we need the full list from both endpoints.
		// Re-fetch any endpoint that returned 304 unconditionally so we have complete data.
		const [issueFull, reviewFull] = await Promise.all([
			issueRes.status === 304
				? githubFetch(`/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`)
				: Promise.resolve(issueRes),
			reviewRes.status === 304
				? githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/comments?per_page=100`)
				: Promise.resolve(reviewRes),
		]);

		const [issueComments, reviewComments] = await Promise.all([
			issueFull.json() as Promise<RawCommentNode[]>,
			reviewFull.json() as Promise<RawCommentNode[]>,
		]);

		const newIssueEtag = issueFull.headers.get("etag") ?? issueEtag ?? "";
		const newReviewEtag = reviewFull.headers.get("etag") ?? reviewEtag ?? "";
		const newCacheKey = joinCacheKey(newIssueEtag, newReviewEtag);

		const all: NormalizedComment[] = [...issueComments, ...reviewComments].map((c) => ({
			id: String(c.id),
			body: c.body ?? "",
			author: c.user?.login ?? "Unknown",
			filePath: c.path ?? null,
			lineNumber: c.line ?? null,
			side: c.side ?? null,
			createdAt: c.created_at ?? "",
		}));

		return { changed: true, comments: all, cacheKey: newCacheKey };
	}

	async createInlineComment(params: CreateCommentParams): Promise<{ id: string; nodeId?: string }> {
		const result = await createReviewThread({
			owner: params.owner,
			repo: params.repo,
			prNumber: params.prNumber,
			body: params.body,
			commitId: params.commitId ?? "",
			path: params.filePath ?? "",
			line: params.line,
			side: params.side,
		});
		return { id: String(result.id), nodeId: result.nodeId };
	}

	async replyToComment(params: ReplyParams): Promise<{ id: string }> {
		const result = await addReviewThreadReply({
			threadId: params.commentId,
			body: params.body,
		});
		return { id: result.id };
	}

	async resolveComment(params: ResolveParams): Promise<void> {
		await resolveThread(params.commentId);
	}

	async unresolveComment(params: ResolveParams): Promise<void> {
		await unresolveThread(params.commentId);
	}

	async submitReview(params: SubmitReviewParams): Promise<void> {
		await submitReview(params);
	}

	async getPRFiles(owner: string, repo: string, prNumber: number): Promise<NormalizedPRFile[]> {
		const files = await getPRFiles(owner, repo, prNumber);
		return files.map((f) => ({
			path: f.path,
			status: f.status,
			previousPath: f.previousPath,
		}));
	}

	async getReviewThreads(
		owner: string,
		repo: string,
		prNumber: number
	): Promise<NormalizedReviewThread[]> {
		return getGitHubReviewThreads(owner, repo, prNumber);
	}

	async getPRDetails(owner: string, repo: string, prNumber: number): Promise<GitHubPRDetails> {
		return getGitHubPRDetails(owner, repo, prNumber);
	}
}
