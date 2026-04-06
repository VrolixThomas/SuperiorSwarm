import { getValidToken } from "../github/auth";
import {
	addReviewThreadReply,
	createReviewThread,
	getGitHubReviewThreads,
	getMyPRs,
	getPRComments,
	getPRDetails,
	getPRFiles,
	getPRState,
	resolveThread,
	submitReview,
	unresolveThread,
} from "../github/github";
import type {
	CreateCommentParams,
	GitProvider,
	NormalizedComment,
	NormalizedPR,
	PRState,
	ReplyParams,
	ResolveParams,
} from "./types";

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
			createdAt: c.createdAt ?? "",
		}));
	}

	async createInlineComment(params: CreateCommentParams): Promise<{ id: string }> {
		const result = await createReviewThread({
			owner: params.owner,
			repo: params.repo,
			prNumber: params.prNumber,
			body: params.body,
			commitId: "",
			path: params.filePath ?? "",
			line: params.line,
		});
		return { id: String(result.id) };
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

	// ── GitHub-specific extras (not on the GitProvider interface) ────────────

	getPRDetails(owner: string, repo: string, prNumber: number) {
		return getPRDetails(owner, repo, prNumber);
	}

	submitReview(params: {
		owner: string;
		repo: string;
		prNumber: number;
		verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
		body: string;
	}) {
		return submitReview(params);
	}

	getPRFiles(owner: string, repo: string, prNumber: number) {
		return getPRFiles(owner, repo, prNumber);
	}

	getReviewThreads(owner: string, repo: string, prNumber: number) {
		return getGitHubReviewThreads(owner, repo, prNumber);
	}
}
