import type { CliPresetName } from "../../shared/cli-preset";
import {
	type ReviewPromptContext,
	assembleReviewPrompt,
	buildReviewHistoryBlock,
	effectiveBody,
	formatPreviousCommentLines,
} from "../../shared/prompt-preview";
import {
	DEFAULT_REVIEW_PROMPT,
	buildFollowUpMcpInstructions,
	buildReviewMcpInstructions,
} from "../../shared/review-prompt";

export { DEFAULT_REVIEW_PROMPT };
export type { CliPresetName };

export interface CliPreset {
	name: string;
	label: string;
	command: string;
	permissionFlag?: string;
	buildArgs: (opts: LaunchOptions) => string[];
}

export interface LaunchOptions {
	mcpServerPath: string;
	worktreePath: string;
	reviewDir: string;
	promptFilePath: string;
	dbPath: string;
	reviewDraftId: string;
	prMetadata: string; // JSON string
	solveSessionId?: string; // When set, MCP uses solve mode instead of review mode
}

export const CLI_PRESETS: Record<string, CliPreset> = {
	claude: {
		name: "claude",
		label: "Claude Code",
		command: "claude",
		permissionFlag: "--dangerously-skip-permissions",
		buildArgs: ({ promptFilePath }) => [
			`"Review this PR. Read ${promptFilePath} for detailed instructions and use the SuperiorSwarm MCP tools."`,
		],
	},
	gemini: {
		name: "gemini",
		label: "Gemini CLI",
		command: "gemini",
		permissionFlag: "--yolo",
		buildArgs: ({ promptFilePath }) => ["-p", `"$(cat '${promptFilePath}')"`],
	},
	codex: {
		name: "codex",
		label: "Codex",
		command: "codex",
		// `--full-auto` was removed in newer codex builds; use config overrides
		// to match prior auto-approve + workspace-write semantics.
		permissionFlag: "-c approval_policy=never -c sandbox_mode=danger-full-access",
		buildArgs: ({ promptFilePath }) => [`"$(cat '${promptFilePath}')"`],
	},
	opencode: {
		name: "opencode",
		label: "OpenCode",
		command: "opencode",
		buildArgs: ({ promptFilePath }) => ["--prompt", `"$(cat '${promptFilePath}')"`],
	},
};

/** Build the review prompt from PR metadata. */
export function buildReviewPrompt(
	ctx: ReviewPromptContext,
	customPrompt: string | null | undefined
): string {
	return assembleReviewPrompt({
		ctx,
		body: effectiveBody(customPrompt, DEFAULT_REVIEW_PROMPT),
		mcpInstructions: buildReviewMcpInstructions(ctx.targetBranch),
	});
}

export type { PreviousCommentContext } from "../../shared/prompt-preview";

export interface FollowUpRoundContext {
	roundNumber: number;
	previousCommitSha: string;
	currentCommitSha: string;
	previousComments: PreviousCommentContext[];
}

/** Build the follow-up review prompt for subsequent review rounds. */
export function buildFollowUpPrompt(
	ctx: ReviewPromptContext,
	customPrompt: string | null | undefined,
	round: FollowUpRoundContext
): string {
	const commentLines = formatPreviousCommentLines(round.previousComments);

	return assembleReviewPrompt({
		ctx,
		body: effectiveBody(customPrompt, DEFAULT_REVIEW_PROMPT),
		reviewHistory: buildReviewHistoryBlock({
			roundNumber: round.roundNumber,
			previousCommitSha: round.previousCommitSha.slice(0, 8),
			currentCommitSha: round.currentCommitSha.slice(0, 8),
			commentLines,
		}),
		mcpInstructions: buildFollowUpMcpInstructions(ctx.targetBranch),
	});
}
