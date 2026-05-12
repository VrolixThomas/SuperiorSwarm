import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER = "# superiorswarm: ignore MCP config strays";
const PATTERNS = [".mcp.json", ".gemini/", ".codex/", "opencode.json"];

/**
 * Append our patterns to `<repoPath>/.git/info/exclude` if not already present.
 * Idempotent. No-op if `.git` is missing (e.g. not a real repo).
 */
export function ensureRepoExclude(repoPath: string): void {
	const gitDir = join(repoPath, ".git");
	if (!existsSync(gitDir)) return;

	// In a worktree, repoPath/.git is a file pointing at the gitdir, not a directory.
	// We always write to the main repo's info/exclude. resolveCommonGitDir handles both.
	const commonDir = resolveCommonGitDir(repoPath);
	if (!commonDir) return;

	const infoDir = join(commonDir, "info");
	const excludeFile = join(infoDir, "exclude");

	const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf-8") : "";
	if (existing.includes(MARKER)) return;

	if (!existsSync(infoDir)) mkdirSync(infoDir, { recursive: true });

	const block = ["", MARKER, ...PATTERNS, ""].join("\n");
	const needsNewline = existing.length > 0 && !existing.endsWith("\n");
	writeFileSync(excludeFile, (needsNewline ? `${existing}\n` : existing) + block, "utf-8");
}

function resolveCommonGitDir(repoPath: string): string | null {
	const gitPath = join(repoPath, ".git");
	try {
		const stat = statSync(gitPath);
		if (stat.isDirectory()) return gitPath;
		// Worktree: .git is a file like "gitdir: /path/to/main/.git/worktrees/<name>"
		const text = readFileSync(gitPath, "utf-8").trim();
		const m = text.match(/^gitdir:\s*(.+)$/);
		if (!m) return null;
		// Resolve commondir (under worktrees/<name>, a file `commondir` points up)
		const worktreeGitDir = m[1] as string;
		const commondirFile = join(worktreeGitDir, "commondir");
		if (!existsSync(commondirFile)) return worktreeGitDir;
		const relCommon = readFileSync(commondirFile, "utf-8").trim();
		return join(worktreeGitDir, relCommon);
	} catch {
		return null;
	}
}
