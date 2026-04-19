import type { DiffFile } from "./diff-types";

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
