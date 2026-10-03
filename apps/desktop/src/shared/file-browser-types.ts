export type FileListingMode = "git-visible" | "browser";

export interface FlatEntry {
	path: string;
	type: "file" | "directory" | "symlink";
}

export interface FileEntry extends FlatEntry {
	name: string;
	size?: number;
}

export interface FileListingOptions {
	mode?: FileListingMode;
}

/** Returned only after an explicit editor read, never by browser enumeration. */
export interface WorkspaceFileContent {
	content: string;
	/** Canonical target of an explicitly opened leaf link; saves must match it. */
	symlinkTarget?: string;
}
