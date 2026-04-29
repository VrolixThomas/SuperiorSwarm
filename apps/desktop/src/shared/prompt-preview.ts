/**
 * Shared assemblers for the full prompt that gets sent to the agent. Used by:
 * - Main process (`buildReviewPrompt` / `buildSolvePrompt`) with real PR metadata.
 * - Renderer (Full Prompt tab) with placeholders, so the user sees exactly what
 *   structure the agent receives — no drift between what's shown and what's sent.
 */

import {
	DEFAULT_REVIEW_PROMPT,
	buildFollowUpMcpInstructions,
	buildReviewMcpInstructions,
} from "./review-prompt";
import {
	DEFAULT_SOLVE_PROMPT,
	SOLVE_FOLLOW_UP_MCP_INSTRUCTIONS,
	SOLVE_MCP_INSTRUCTIONS,
} from "./solve-prompt";

export interface ReviewPromptContext {
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	provider: "github" | "bitbucket";
}

export interface SolvePromptContext {
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
	commentCount: number;
}

export interface PreviousCommentContext {
	id: string;
	filePath: string;
	lineNumber: number | null;
	body: string;
	platformStatus: "open" | "resolved-on-platform";
}

const PREVIEW_TRUNCATE = 100;

/**
 * Format the list of prior review comments into the `commentLines` block used
 * by the review history. Each line: `N. [path:line] "preview..." -- STATUS: ... (id: ...)`.
 */
export function formatPreviousCommentLines(comments: PreviousCommentContext[]): string {
	return comments
		.map((c, i) => {
			const location = c.lineNumber ? `${c.filePath}:${c.lineNumber}` : c.filePath;
			const status =
				c.platformStatus === "resolved-on-platform"
					? "resolved by author on platform"
					: "still on PR";
			const preview =
				c.body.length > PREVIEW_TRUNCATE ? `${c.body.slice(0, PREVIEW_TRUNCATE)}...` : c.body;
			return `${i + 1}. [${location}] "${preview}" -- STATUS: ${status} (id: ${c.id})`;
		})
		.join("\n");
}

export interface ReviewHistoryFields {
	roundNumber: number;
	previousCommitSha: string;
	currentCommitSha: string;
	commentLines: string;
}

const REVIEW_PLACEHOLDERS: ReviewPromptContext = {
	title: "{{title}}",
	author: "{{author}}",
	sourceBranch: "{{sourceBranch}}",
	targetBranch: "{{targetBranch}}",
	provider: "{{provider}}",
};

/** Returns the user's customized body when set, otherwise the default. */
export function effectiveBody(custom: string | null | undefined, fallback: string): string {
	return custom?.trim() || fallback;
}

/** Wrap an ordered list of sections in a `<tag>...</tag>` envelope. Empty/null sections are skipped. */
function envelope(tag: string, sections: (string | null | undefined)[]): string {
	const body = sections.filter((s): s is string => Boolean(s)).join("\n\n");
	return `<${tag}>\n${body}\n</${tag}>`;
}

function reviewContextBlock(ctx: ReviewPromptContext): string {
	return `<pr_context>
Title: ${ctx.title}
Author: ${ctx.author}
Source: ${ctx.sourceBranch} → Target: ${ctx.targetBranch}
Provider: ${ctx.provider}
</pr_context>`;
}

function solveContextBlock(ctx: SolvePromptContext): string {
	return `<pr_context>
Title: ${ctx.prTitle}
Branch: ${ctx.sourceBranch} → ${ctx.targetBranch}
Unresolved comments: ${ctx.commentCount}

You are helping the PR author fix review comments. Reviewers have left feedback that needs to be addressed through code changes.
</pr_context>`;
}

export interface SolveFollowUpFields {
	prTitle: string;
	sessionId: string;
	sourceBranch: string;
	targetBranch: string;
	groupLabel: string;
	commitHash: string;
	commentAuthor: string;
	commentLocation: string;
	commentBody: string;
	commentStatus: string;
	followUpText: string;
}

/** Render the solve-follow-up `<pr_context>` block. Used at runtime and in placeholders. */
export function buildSolveFollowUpContextBlock(fields: SolveFollowUpFields): string {
	return `<pr_context>
PR: ${fields.prTitle}
Session ID: ${fields.sessionId}
Source: ${fields.sourceBranch} → Target: ${fields.targetBranch}

You are following up on a previous comment-solve session.

Group: "${fields.groupLabel}" (commit ${fields.commitHash})

Original comment by @${fields.commentAuthor} at ${fields.commentLocation}:
"${fields.commentBody}"

The AI solver previously marked this comment as: ${fields.commentStatus}

The user's follow-up instruction:
"${fields.followUpText}"
</pr_context>`;
}

/** Render the `<review_history>` block. Used at runtime (with real SHAs) and in placeholders. */
export function buildReviewHistoryBlock(fields: ReviewHistoryFields): string {
	return `<review_history>
This is review round ${fields.roundNumber}. Previous review was on commit ${fields.previousCommitSha}.
Current HEAD is ${fields.currentCommitSha}.

Previous comments and their current state:
${fields.commentLines}
</review_history>`;
}

/** Compose the full review prompt the agent receives (initial or follow-up). */
export function assembleReviewPrompt(opts: {
	ctx: ReviewPromptContext;
	body: string;
	reviewHistory?: string;
	mcpInstructions: string;
}): string {
	return envelope("review_task", [
		reviewContextBlock(opts.ctx),
		opts.body,
		opts.reviewHistory,
		opts.mcpInstructions,
	]);
}

/** Compose the full solve prompt the agent receives. */
export function assembleSolvePrompt(opts: {
	ctx: SolvePromptContext;
	body: string;
	mcpInstructions: string;
}): string {
	return envelope("solve_task", [solveContextBlock(opts.ctx), opts.body, opts.mcpInstructions]);
}

/**
 * Compose the full solve-follow-up prompt. Takes a pre-built context block
 * (different shape than first-turn solve — includes session/group/comment
 * metadata) so callers stay in charge of what goes into <pr_context>.
 */
export function assembleSolveFollowUpPrompt(opts: {
	contextBlock: string;
	body: string;
	mcpInstructions: string;
}): string {
	return envelope("solve_task", [opts.contextBlock, opts.body, opts.mcpInstructions]);
}

/** Render the full review prompt with placeholders for the UI Full Prompt tab. */
export function renderReviewFullPrompt(body: string): string {
	return assembleReviewPrompt({
		ctx: REVIEW_PLACEHOLDERS,
		body: effectiveBody(body, DEFAULT_REVIEW_PROMPT),
		mcpInstructions: buildReviewMcpInstructions(REVIEW_PLACEHOLDERS.targetBranch),
	});
}

/** Render the full follow-up review prompt with placeholders. */
export function renderReviewFollowUpFullPrompt(body: string): string {
	const reviewHistory = `<review_history>
This is review round {{roundNumber}}. Previous review was on commit {{previousCommitSha}}.
Current HEAD is {{currentCommitSha}}.

Previous comments and their current state:
{{previousCommentList}}
</review_history>`;
	return assembleReviewPrompt({
		ctx: REVIEW_PLACEHOLDERS,
		body: effectiveBody(body, DEFAULT_REVIEW_PROMPT),
		reviewHistory,
		mcpInstructions: buildFollowUpMcpInstructions(REVIEW_PLACEHOLDERS.targetBranch),
	});
}

/** Render the full solve prompt with placeholders for the UI Full Prompt tab. */
export function renderSolveFullPrompt(body: string): string {
	const contextBlock = `<pr_context>
Title: {{title}}
Branch: {{sourceBranch}} → {{targetBranch}}
Unresolved comments: {{commentCount}}

You are helping the PR author fix review comments. Reviewers have left feedback that needs to be addressed through code changes.
</pr_context>`;
	return envelope("solve_task", [
		contextBlock,
		effectiveBody(body, DEFAULT_SOLVE_PROMPT),
		SOLVE_MCP_INSTRUCTIONS,
	]);
}

/** Render the full solve-follow-up prompt with placeholders. */
export function renderSolveFollowUpFullPrompt(body: string): string {
	const contextBlock = buildSolveFollowUpContextBlock({
		prTitle: "{{prTitle}}",
		sessionId: "{{sessionId}}",
		sourceBranch: "{{sourceBranch}}",
		targetBranch: "{{targetBranch}}",
		groupLabel: "{{groupLabel}}",
		commitHash: "{{commitHash}}",
		commentAuthor: "{{commentAuthor}}",
		commentLocation: "{{commentLocation}}",
		commentBody: "{{commentBody}}",
		commentStatus: "{{commentStatus}}",
		followUpText: "{{followUpText}}",
	});

	return assembleSolveFollowUpPrompt({
		contextBlock,
		body: effectiveBody(body, DEFAULT_SOLVE_PROMPT),
		mcpInstructions: SOLVE_FOLLOW_UP_MCP_INSTRUCTIONS,
	});
}
