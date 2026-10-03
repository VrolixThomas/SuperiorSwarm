export type FileListingMode = "git-visible" | "browser";

export interface FlatEntry {
	path: string;
	type: "file" | "directory";
}

export interface FileEntry extends FlatEntry {
	name: string;
	size?: number;
}

export interface FileListingOptions {
	mode?: FileListingMode;
}
