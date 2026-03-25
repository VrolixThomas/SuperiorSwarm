import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_REVIEW_GUIDELINES } from "../../shared/review-prompt";

export { DEFAULT_REVIEW_GUIDELINES };

export interface CliPreset {
	name: string;
	label: string;
	command: string;
	permissionFlag?: string;
	buildArgs: (opts: LaunchOptions) => string[];
	setupMcp?: (opts: LaunchOptions) => CleanupFn;
}

type CleanupFn = () => void;

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

function writeTempMcpConfig(
	dir: string,
	filename: string,
	mcpServerPath: string,
	env?: Record<string, string>
): string {
	mkdirSync(dir, { recursive: true });
	const configPath = join(dir, filename);
	const config = {
		mcpServers: {
			branchflux: {
				command: "node",
				args: [mcpServerPath],
				...(env ? { env } : {}),
			},
		},
	};
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	return configPath;
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

export const CLI_PRESETS: Record<string, CliPreset> = {
	claude: {
		name: "claude",
		label: "Claude Code",
		command: "claude",
		permissionFlag: "--dangerously-skip-permissions",
		buildArgs: ({ promptFilePath }) => [
			`"Review this PR. Read ${promptFilePath} for detailed instructions and use the BranchFlux MCP tools."`,
		],
		setupMcp: (opts) => {
			// Claude Code reads MCP config from .mcp.json in the project root
			// Use standalone server with system Node (Electron's Node has incompatible native modules)
			const standaloneServerPath = resolve(
				dirname(__dirname),
				"..",
				"mcp-standalone",
				"server.mjs"
			);
			const configPath = join(opts.worktreePath, ".mcp.json");
			const config = {
				mcpServers: {
					branchflux: {
						command: "node",
						args: [standaloneServerPath],
						env: buildMcpEnv(opts),
					},
				},
			};
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
			return () => {
				try {
					rmSync(configPath);
				} catch {}
			};
		},
	},
	gemini: {
		name: "gemini",
		label: "Gemini CLI",
		command: "gemini",
		permissionFlag: "--yolo",
		buildArgs: ({ promptFilePath }) => ["-p", `"$(cat '${promptFilePath}')"`],
		setupMcp: (opts) => {
			// Gemini CLI reads MCP config from .gemini/settings.json in the project root
			const standaloneServerPath = resolve(
				dirname(__dirname),
				"..",
				"mcp-standalone",
				"server.mjs"
			);
			const dir = join(opts.worktreePath, ".gemini");
			mkdirSync(dir, { recursive: true });
			const configPath = join(dir, "settings.json");
			const config = {
				mcpServers: {
					branchflux: {
						command: "node",
						args: [standaloneServerPath],
						env: buildMcpEnv(opts),
					},
				},
			};
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
			return () => {
				try {
					rmSync(configPath);
					rmSync(dir, { recursive: true });
				} catch {}
			};
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
			const configPath = writeTempMcpConfig(
				dir,
				"config.json",
				opts.mcpServerPath,
				buildMcpEnv(opts)
			);
			return () => {
				try {
					rmSync(configPath);
					rmSync(dir, { recursive: true });
				} catch {}
			};
		},
	},
	opencode: {
		name: "opencode",
		label: "OpenCode",
		command: "opencode",
		buildArgs: ({ promptFilePath }) => ["--prompt", `"$(cat '${promptFilePath}')"`],
		setupMcp: (opts) => {
			// OpenCode reads MCP config from opencode.json in the project root
			const standaloneServerPath = resolve(
				dirname(__dirname),
				"..",
				"mcp-standalone",
				"server.mjs"
			);
			const configPath = join(opts.worktreePath, "opencode.json");
			const config = {
				mcp: {
					branchflux: {
						type: "local",
						command: ["node", standaloneServerPath],
						environment: buildMcpEnv(opts),
					},
				},
			};
			writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
			return () => {
				try {
					rmSync(configPath);
				} catch {}
			};
		},
	},
};

/** Check if a CLI tool is installed and available on PATH */
export function isCliInstalled(command: string): boolean {
	try {
		execSync(`which ${command}`, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/** Resolve the absolute path to a CLI tool, or return the command name as fallback */
export function resolveCliPath(command: string): string {
	try {
		return execSync(`which ${command}`, { encoding: "utf-8" }).trim();
	} catch {
		return command;
	}
}

/** Build the locked MCP tool instructions block */
function buildMcpInstructions(targetBranch: string): string {
	return `
You MUST use the BranchFlux MCP tools to complete your review:

1. Call \`get_pr_metadata\` to understand the PR context
2. Explore the codebase and review the changes (use git diff origin/${targetBranch}...HEAD to see the changes)
3. For each issue or suggestion, call \`add_draft_comment\` with the file path, line number, and your comment
4. When done reviewing all files, call \`set_review_summary\` with a markdown summary including:
   - Overview of changes
   - Key changes per file
   - Risk assessment (Low/Medium/High)
   - Recommendations
5. Call \`finish_review\` to signal you are done

IMPORTANT: You MUST call finish_review when done. Do NOT skip any MCP tool steps.`;
}

/** Build the review prompt from PR metadata */
export function buildReviewPrompt(metadata: {
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	provider: string;
	customPrompt?: string | null;
}): string {
	const prContext = `You are reviewing Pull Request: ${metadata.title}
Author: ${metadata.author}
Source: ${metadata.sourceBranch} → Target: ${metadata.targetBranch}
Provider: ${metadata.provider}`;

	const guidelines = metadata.customPrompt?.trim() || DEFAULT_REVIEW_GUIDELINES;
	const mcpInstructions = buildMcpInstructions(metadata.targetBranch);

	return `${prContext}\n\n${guidelines}\n${mcpInstructions}`;
}

export interface PreviousCommentContext {
	id: string;
	filePath: string;
	lineNumber: number | null;
	body: string;
	platformStatus: "open" | "resolved-on-platform";
}

/** Build the follow-up review prompt for subsequent review rounds */
export function buildFollowUpPrompt(metadata: {
	title: string;
	author: string;
	sourceBranch: string;
	targetBranch: string;
	provider: string;
	customPrompt?: string | null;
	roundNumber: number;
	previousCommitSha: string;
	currentCommitSha: string;
	previousComments: PreviousCommentContext[];
}): string {
	const prContext = `You are reviewing Pull Request: ${metadata.title}
Author: ${metadata.author}
Source: ${metadata.sourceBranch} → Target: ${metadata.targetBranch}
Provider: ${metadata.provider}`;

	const commentLines = metadata.previousComments
		.map((c, i) => {
			const location = c.lineNumber ? `${c.filePath}:${c.lineNumber}` : c.filePath;
			const status =
				c.platformStatus === "resolved-on-platform"
					? "resolved by author on platform"
					: "still on PR";
			const preview = c.body.length > 100 ? `${c.body.slice(0, 100)}...` : c.body;
			return `${i + 1}. [${location}] "${preview}" -- STATUS: ${status} (id: ${c.id})`;
		})
		.join("\n");

	const reviewHistory = `This is review round ${metadata.roundNumber}. Previous review was on commit ${metadata.previousCommitSha.slice(0, 8)}.
Current HEAD is ${metadata.currentCommitSha.slice(0, 8)}.

Previous comments and their current state:
${commentLines}`;

	const guidelines = metadata.customPrompt?.trim() || DEFAULT_REVIEW_GUIDELINES;

	const mcpInstructions = buildFollowUpMcpInstructions(metadata.targetBranch);

	return `${prContext}\n\n=== REVIEW HISTORY ===\n${reviewHistory}\n\n${guidelines}\n${mcpInstructions}`;
}

/** Build the locked MCP tool instructions block for follow-up reviews */
function buildFollowUpMcpInstructions(targetBranch: string): string {
	return `
You MUST use the BranchFlux MCP tools to complete your follow-up review:

1. Call \`get_pr_metadata\` to understand the PR context
2. Call \`get_previous_comments\` to get the full details of previous review comments
3. Explore the codebase and review the changes (use git diff origin/${targetBranch}...HEAD)
4. For each previous comment, assess whether the new code addresses it:
   - If resolved by new code: call \`resolve_comment\` with the previous comment ID and your reasoning
   - If the author resolved it on the platform but the fix looks wrong: call \`flag_comment\` with the previous comment ID and why the fix is insufficient
   - If still unresolved: do nothing (it stays open)
5. Review new changes for any NEW issues — call \`add_draft_comment\` as before
6. Call \`set_review_summary\` with an updated summary covering this round's findings
7. Call \`finish_review\` to signal you are done

IMPORTANT: You MUST call finish_review when done. Do NOT skip any MCP tool steps.
IMPORTANT: Do NOT modify any files. This is a read-only code review.`;
}
