import type { DiffFile } from "./diff-types";

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
	role: "author" | "reviewer";
	headCommitSha: string;
}

export type ReviewScope = "all" | "working" | "branch";

export type WorkingSubScope = "staged" | "unstaged" | "untracked";

/** A DiffFile tagged with which scope it came from. */
export interface ScopedDiffFile extends DiffFile {
	scope: "working" | "branch";
	/** Only set when scope === "working" */
	workingSubScope?: WorkingSubScope;
}

export interface ReviewViewedRecord {
	workspaceId: string;
	filePath: string;
	contentHash: string;
	viewedAt: Date;
}
