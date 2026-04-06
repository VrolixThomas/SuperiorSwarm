import type { GitHubPRDetails } from "../../shared/github-types";
import { getValidToken } from "../github/auth";
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
			createdAt: c.createdAt ?? "",
		}));
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
