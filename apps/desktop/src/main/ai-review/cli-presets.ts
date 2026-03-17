import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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
}

function writeTempMcpConfig(dir: string, filename: string, mcpServerPath: string): string {
	mkdirSync(dir, { recursive: true });
	const configPath = join(dir, filename);
	const config = {
		mcpServers: {
			branchflux: {
				command: "node",
				args: [mcpServerPath],
			},
		},
	};
	writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	return configPath;
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
		setupMcp: ({ worktreePath, reviewDraftId, prMetadata, dbPath }) => {
			// Claude Code reads MCP config from .mcp.json in the project root
			// Use standalone server with system Node (Electron's Node has incompatible native modules)
			const standaloneServerPath = resolve(
				dirname(__dirname),
				"..",
				"mcp-standalone",
				"server.mjs"
			);
			const configPath = join(worktreePath, ".mcp.json");
			const config = {
				mcpServers: {
					branchflux: {
						command: "node",
						args: [standaloneServerPath],
						env: {
							REVIEW_DRAFT_ID: reviewDraftId,
							PR_METADATA: prMetadata,
							DB_PATH: dbPath,
						},
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
		buildArgs: ({ reviewDir, promptFilePath }) => [
			"--mcp-config",
			join(reviewDir, "mcp-config.json"),
			"-p",
			`"$(cat '${promptFilePath}')"`,
		],
		setupMcp: ({ reviewDir, mcpServerPath }) => {
			const configPath = writeTempMcpConfig(reviewDir, "mcp-config.json", mcpServerPath);
			return () => {
				try {
					rmSync(configPath);
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
		setupMcp: ({ worktreePath, mcpServerPath }) => {
			const dir = join(worktreePath, ".codex");
			const configPath = writeTempMcpConfig(dir, "config.json", mcpServerPath);
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
		buildArgs: ({ promptFilePath }) => [`"$(cat '${promptFilePath}')"`],
		setupMcp: ({ worktreePath, mcpServerPath }) => {
			const dir = join(worktreePath, ".opencode");
			const configPath = writeTempMcpConfig(dir, "config.json", mcpServerPath);
			return () => {
				try {
					rmSync(configPath);
					rmSync(dir, { recursive: true });
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

/** Default review guidelines — used when user hasn't set a custom prompt */
export const DEFAULT_REVIEW_GUIDELINES = `Focus on: bugs, security issues, performance problems, code style, logic errors, and missing edge cases.

IMPORTANT: Do NOT modify any files. This is a read-only code review.`;

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
