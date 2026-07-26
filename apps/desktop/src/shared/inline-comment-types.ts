export type InlineCommentStatus = "pending" | "sent";

export interface InlineComment {
	id: string;
	workspaceId: string;
	repoPath: string;
	filePath: string;
	/** 1-based, inclusive, modified side of the diff. Equal for single-line comments. */
	startLine: number;
	endLine: number;
	/** The commented lines' text at comment time — used for re-anchoring and prompt context. */
	codeSnapshot: string;
	body: string;
	status: InlineCommentStatus;
	createdAt: Date;
	sentAt: Date | null;
}
