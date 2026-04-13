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
	ahead: number;
	behind: number;
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

/**
 * How the two sides relate to each other in the index.
 * - modify/modify: both sides changed the same file
 * - add/add:       both sides added the same path (no common ancestor)
 * - delete/modify: ours deleted, theirs modified
 * - modify/delete: ours modified, theirs deleted
 * - add/delete:    ours added, theirs deleted (or vice-versa)
 * - delete/add:    ours deleted, theirs added (or vice-versa)
 * - unknown:       stages couldn't be determined
 */
export type ConflictType =
	| "modify/modify"
	| "add/add"
	| "delete/modify"
	| "modify/delete"
	| "add/delete"
	| "delete/add"
	| "unknown";

export interface ConflictContent {
	base: string;
	ours: string;
	theirs: string;
	conflictType: ConflictType;
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
