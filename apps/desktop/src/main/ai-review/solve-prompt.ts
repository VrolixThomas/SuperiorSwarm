import {
	assembleSolveFollowUpPrompt,
	assembleSolvePrompt,
	buildSolveFollowUpContextBlock,
	effectiveBody,
} from "../../shared/prompt-preview";
import {
	DEFAULT_SOLVE_PROMPT,
	SOLVE_FOLLOW_UP_MCP_INSTRUCTIONS,
	SOLVE_MCP_INSTRUCTIONS,
} from "../../shared/solve-prompt";

export { DEFAULT_SOLVE_PROMPT };

export interface SolveFollowUpOptions {
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	sessionId: string;
	groupLabel: string;
	commitHash: string;
	commentAuthor: string;
	commentFilePath: string;
	commentLineNumber: number | null;
	commentBody: string;
	commentStatus: string;
	followUpText: string;
	customPrompt?: string | null;
}

export function buildSolveFollowUpPrompt(opts: SolveFollowUpOptions): string {
	const location = opts.commentLineNumber
		? `${opts.commentFilePath}:${opts.commentLineNumber}`
		: opts.commentFilePath;

	const contextBlock = buildSolveFollowUpContextBlock({
		prTitle: opts.prTitle,
		sessionId: opts.sessionId,
		sourceBranch: opts.sourceBranch,
		targetBranch: opts.targetBranch,
		groupLabel: opts.groupLabel,
		commitHash: opts.commitHash,
		commentAuthor: opts.commentAuthor,
		commentLocation: location,
		commentBody: opts.commentBody,
		commentStatus: opts.commentStatus,
		followUpText: opts.followUpText,
	});

	return assembleSolveFollowUpPrompt({
		contextBlock,
		body: effectiveBody(opts.customPrompt, DEFAULT_SOLVE_PROMPT),
		mcpInstructions: SOLVE_FOLLOW_UP_MCP_INSTRUCTIONS,
	});
}

export interface SolvePromptOptions {
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	commentCount: number;
	customPrompt?: string | null;
}

export function buildSolvePrompt(opts: SolvePromptOptions): string {
	const { customPrompt, ...ctx } = opts;
	return assembleSolvePrompt({
		ctx,
		body: effectiveBody(customPrompt, DEFAULT_SOLVE_PROMPT),
		mcpInstructions: SOLVE_MCP_INSTRUCTIONS,
	});
}
