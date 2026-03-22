export interface CachedPR {
	provider: "github" | "bitbucket";
	identifier: string;
	number: number;
	title: string;
	state: "open" | "merged" | "declined" | "closed";
	sourceBranch: string;
	targetBranch: string;
	author: { login: string; avatarUrl: string };
	reviewers: Array<{ login: string; avatarUrl: string; state: string }>;
	ciStatus: string | null;
	commentCount: number;
	changedFiles: number;
	additions: number;
	deletions: number;
	updatedAt: string;
	repoOwner: string;
	repoName: string;
	projectId: string;
}
