export const workspaceErrorMessages = {
	WORKSPACE_NOT_FOUND: "Workspace not found.",
	WORKSPACE_KIND_UNSUPPORTED: "Coordinator kind does not support terminals.",
	WORKSPACE_PATH_INVALID: "Workspace folder path is invalid.",
	WORKSPACE_FOLDER_MISSING: "Workspace folder no longer exists.",
	WORKSPACE_NOT_DIRECTORY: "Workspace folder is not a directory.",
	WORKSPACE_FOLDER_UNAVAILABLE: "Workspace folder cannot be accessed.",
	WORKSPACE_PROJECT_MISSING: "Workspace project not found.",
	WORKSPACE_WORKTREE_MISSING: "Workspace worktree record not found.",
	WORKSPACE_ROOT_CHANGED: "Workspace root changed. Reopen the terminal.",
} as const;

export type WorkspaceErrorCode = keyof typeof workspaceErrorMessages;

/** Safe renderer copy; filesystem details belong in main-process logs. */
export class WorkspaceError extends Error {
	constructor(public readonly code: WorkspaceErrorCode) {
		super(workspaceErrorMessages[code]);
		this.name = "WorkspaceError";
	}
}
