/** Version 1 is a local, immutable code snapshot, independent of review publication. */
export interface ReviewSnapshotRevision {
	workspaceId: string;
	targetTipOid: string;
	headOid: string;
}

export type ReviewSnapshotSide = "base" | "head";

export interface ReviewSnapshotObject {
	path: string;
	oid: string;
	mode: string;
}

export interface ReviewSnapshotFile {
	id: string;
	path: string;
	oldPath?: string;
	status: "added" | "modified" | "deleted" | "renamed" | "copied" | "type-changed";
	base: ReviewSnapshotObject | null;
	head: ReviewSnapshotObject | null;
}

export interface ReviewSnapshot extends ReviewSnapshotRevision {
	version: 1;
	id: string;
	repositoryKey: string;
	mergeBaseOid: string;
	/** Complete changed-file metadata; content availability is reported separately. */
	files: ReviewSnapshotFile[];
	/** Similarity detection is bounded. Unmatched renames remain visible as add/delete pairs. */
	renameDetection: "bounded";
}

export interface ReviewSnapshotFileRequest {
	workspaceId: string;
	snapshotId: string;
	fileId: string;
	side: ReviewSnapshotSide;
}

export type ReviewSnapshotContent =
	| { kind: "absent" }
	| { kind: "text"; path: string; blobOid: string; content: string }
	| {
			kind: "omitted";
			reason:
				| "symlink"
				| "submodule"
				| "binary"
				| "non-utf8"
				| "too-large"
				| "lfs-pointer"
				| "unsupported-mode";
			path: string;
			blobOid: string;
	  }
	| { kind: "unavailable"; reason: "object-unavailable"; path: string; blobOid: string };
