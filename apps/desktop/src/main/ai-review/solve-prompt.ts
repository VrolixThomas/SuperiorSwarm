import {
	assembleSolveFollowUpPrompt,
	assembleSolvePrompt,
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

	const contextBlock = `<pr_context>
PR: ${opts.prTitle}
Session ID: ${opts.sessionId}
Source: ${opts.sourceBranch} → Target: ${opts.targetBranch}

You are following up on a previous comment-solve session.

Group: "${opts.groupLabel}" (commit ${opts.commitHash})

Original comment by @${opts.commentAuthor} at ${location}:
"${opts.commentBody}"

The AI solver previously marked this comment as: ${opts.commentStatus}

The user's follow-up instruction:
"${opts.followUpText}"
</pr_context>`;

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
