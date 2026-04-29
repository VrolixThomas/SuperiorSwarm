import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
	setupMcp?: (opts: LaunchOptions) => CleanupFn;
}

type CleanupFn = () => void;
type McpConfigBuilder = (command: string, args: string[], env: Record<string, string>) => unknown;

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

/**
 * Returns the command + extra env needed to run the MCP standalone server
 * via Electron's own embedded Node (`ELECTRON_RUN_AS_NODE=1`).
 *
 * We do not shell out to the user's system `node` because (a) many users do
 * not have Node installed at all, and (b) even when they do, its ABI may
 * not match the prebuilt `better-sqlite3` binary we ship in
 * `mcp-standalone/node_modules`. The packaging pipeline rebuilds that
 * binary against Electron's ABI (see `scripts/rebuild-mcp-native.mjs`), so
 * running it through Electron's own Node is guaranteed to work for every
 * user of every release.
 */
function mcpRuntimeCommand(): { command: string; extraEnv: Record<string, string> } {
	return {
		command: process.execPath,
		extraEnv: { ELECTRON_RUN_AS_NODE: "1" },
	};
}

/**
 * Write a per-CLI MCP config file and return a cleanup that removes it (and
 * any subdir we created for it). Each CLI has its own JSON shape, so callers
 * pass a builder that turns the resolved (command, args, env) into the
 * provider's expected config object.
 */
function writeMcpConfig(
	opts: LaunchOptions,
	loc: { dir?: string; file: string },
	build: McpConfigBuilder
): CleanupFn {
	const { command, extraEnv } = mcpRuntimeCommand();
	const env = { ...buildMcpEnv(opts), ...extraEnv };
	if (loc.dir) mkdirSync(loc.dir, { recursive: true });
	const config = build(command, [opts.mcpServerPath], env);
	writeFileSync(loc.file, JSON.stringify(config, null, 2), "utf-8");
	return () => {
		try {
			rmSync(loc.file);
			if (loc.dir) rmSync(loc.dir, { recursive: true });
		} catch {}
	};
}

function buildMcpEnv(opts: LaunchOptions): Record<string, string> {
	if (opts.solveSessionId) {
		return {
			SOLVE_SESSION_ID: opts.solveSessionId,
			PR_METADATA: opts.prMetadata,
			DB_PATH: opts.dbPath,
			WORKTREE_PATH: opts.worktreePath,
		};
	}
	return {
		REVIEW_DRAFT_ID: opts.reviewDraftId,
		PR_METADATA: opts.prMetadata,
		DB_PATH: opts.dbPath,
	};
}

/** Shape used by Claude/Gemini/Codex — three CLIs all consume the same JSON. */
const STANDARD_MCP_BUILD: McpConfigBuilder = (command, args, env) => ({
	mcpServers: { superiorswarm: { command, args, env } },
});

export const CLI_PRESETS: Record<string, CliPreset> = {
	claude: {
		name: "claude",
		label: "Claude Code",
		command: "claude",
		permissionFlag: "--dangerously-skip-permissions",
		buildArgs: ({ promptFilePath }) => [
			`"Review this PR. Read ${promptFilePath} for detailed instructions and use the SuperiorSwarm MCP tools."`,
		],
		// Claude Code reads MCP config from .mcp.json in the project root.
		// We launch the standalone server through Electron's own Node so we
		// don't depend on the user's system Node version.
		setupMcp: (opts) =>
			writeMcpConfig(opts, { file: join(opts.worktreePath, ".mcp.json") }, STANDARD_MCP_BUILD),
	},
	gemini: {
		name: "gemini",
		label: "Gemini CLI",
		command: "gemini",
		permissionFlag: "--yolo",
		buildArgs: ({ promptFilePath }) => ["-p", `"$(cat '${promptFilePath}')"`],
		// Gemini CLI reads MCP config from .gemini/settings.json in the project root.
		setupMcp: (opts) => {
			const dir = join(opts.worktreePath, ".gemini");
			return writeMcpConfig(opts, { dir, file: join(dir, "settings.json") }, STANDARD_MCP_BUILD);
		},
	},
	codex: {
		name: "codex",
		label: "Codex",
		command: "codex",
		permissionFlag: "--full-auto",
		buildArgs: ({ promptFilePath }) => [`"$(cat '${promptFilePath}')"`],
		setupMcp: (opts) => {
			const dir = join(opts.worktreePath, ".codex");
			return writeMcpConfig(opts, { dir, file: join(dir, "config.json") }, STANDARD_MCP_BUILD);
		},
	},
	opencode: {
		name: "opencode",
		label: "OpenCode",
		command: "opencode",
		buildArgs: ({ promptFilePath }) => ["--prompt", `"$(cat '${promptFilePath}')"`],
		// OpenCode reads MCP config from opencode.json in the project root.
		setupMcp: (opts) =>
			writeMcpConfig(
				opts,
				{ file: join(opts.worktreePath, "opencode.json") },
				(command, args, environment) => ({
					mcp: {
						superiorswarm: {
							type: "local",
							command: [command, ...args],
							environment,
						},
					},
				})
			),
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
