export interface BranchInfo {
	name: string;
	isLocal: boolean;
	isRemote: boolean;
	tracking: string | null;
	lastCommit: {
		hash: string;
		message: string;
		date: string;
		author: string;
	} | null;
	hasWorkspace: boolean;
	isDefault: boolean;
	isCurrent: boolean;
}

export interface BranchStatus {
	branch: string;
	tracking: string | null;
	ahead: number;
	behind: number;
	state: "clean" | "merging" | "rebasing" | "cherry-picking";
}

export interface ConflictFile {
	path: string;
	status: "conflicting" | "resolved";
}

export interface ConflictContent {
	base: string;
	ours: string;
	theirs: string;
}

export interface MergeResult {
	status: "ok" | "conflict";
	files?: string[];
}

export interface RebaseResult {
	status: "ok" | "conflict";
	files?: string[];
	progress?: { current: number; total: number };
}
