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

/** Independent pattern migration, including worktrees and old installations. */
export async function ensureAttachmentExclude(repoPath: string, helper: string): Promise<void> {
	const { constants } = await import("node:fs");
	const { lstat, open, realpath } = await import("node:fs/promises");
	const { resolve } = await import("node:path");
	const { execFile } = await import("node:child_process");
	const readPointer = async (path: string) => {
		const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const info = await file.stat();
			if (!info.isFile() || info.size > 16 * 1024) throw new Error("Invalid Git metadata.");
			return (await file.readFile("utf8")).replace(/\r?\n$/, "");
		} finally {
			await file.close();
		}
	};
	let gitPath = join(repoPath, ".git");
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(gitPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	if (info.isSymbolicLink())
		throw new Error("Git metadata is a symlink; cannot establish attachment exclusion.");
	if (info.isFile()) {
		const pointer = (await readPointer(gitPath)).match(/^gitdir: (.+)$/);
		if (!pointer?.[1]) throw new Error("Invalid Git worktree metadata.");
		gitPath = resolve(repoPath, pointer[1]);
		try {
			gitPath = resolve(gitPath, await readPointer(join(gitPath, "commondir")));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	gitPath = await realpath(gitPath);
	info = await lstat(gitPath);
	await new Promise<void>((done, reject) =>
		execFile(
			helper,
			[
				"exclude",
				gitPath,
				"00000000-0000-0000-0000-000000000000",
				String(info.dev),
				String(info.ino),
				"0",
			],
			{ timeout: 5000, maxBuffer: 4096 },
			(error) => {
				if (error)
					reject(
						new Error(
							"Cannot establish local Git exclusion. Check Git metadata and permissions; no copy was made."
						)
					);
				else done();
			}
		)
	);
}
