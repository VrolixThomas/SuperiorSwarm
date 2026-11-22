export type OwnedChatProvider = "claude" | "codex";

/** Server-resolved launch metadata; callers never supply a binary, argv, policy or cwd. */
export interface OwnedChatLaunch {
	workspaceId: string;
	terminalId: string;
	cwd: string;
	title: string;
	scriptPath: string;
}
