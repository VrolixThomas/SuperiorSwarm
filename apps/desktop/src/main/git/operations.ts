import { existsSync, mkdirSync } from "node:fs";
import simpleGit, { type SimpleGitProgressEvent } from "simple-git";

export function validateGitUrl(url: string): boolean {
	if (!url || url.length < 5) return false;
	if (/^https?:\/\/.+\/.+/.test(url)) return true;
	if (/^git@.+:.+/.test(url)) return true;
	if (/^git:\/\/.+\/.+/.test(url)) return true;
	return false;
}

export function extractRepoName(url: string): string {
	const cleaned = url.replace(/\.git$/, "");
	if (cleaned.includes(":") && !cleaned.includes("://")) {
		const afterColon = cleaned.split(":").pop() ?? "";
		return afterColon.split("/").pop() ?? cleaned;
	}
	return cleaned.split("/").pop() ?? cleaned;
}

export interface RemoteInfo {
	host: string;
	owner: string;
	repo: string;
}

export function parseRemoteInfo(url: string): RemoteInfo | null {
	const cleaned = url.replace(/\.git$/, "");

	// HTTPS: https://host/owner/repo
	const httpsMatch = cleaned.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
	if (httpsMatch?.[1] && httpsMatch[2] && httpsMatch[3]) {
		return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
	}

	// SSH: git@host:owner/repo
	const sshMatch = cleaned.match(/^git@([^:]+):([^/]+)\/([^/]+)$/);
	if (sshMatch?.[1] && sshMatch[2] && sshMatch[3]) {
		return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
	}

	return null;
}

export interface CloneProgress {
	stage: string;
	progress: number;
	processed: number;
	total: number;
}

export async function cloneRepo(
	url: string,
	targetPath: string,
	onProgress?: (progress: CloneProgress) => void
): Promise<void> {
	const git = onProgress
		? simpleGit({
				progress(event: SimpleGitProgressEvent) {
					onProgress({
						stage: event.stage,
						progress: event.progress,
						processed: event.processed,
						total: event.total,
					});
				},
			})
		: simpleGit();

	await git.clone(url, targetPath, ["--progress"]);
}

export async function initRepo(path: string, initialBranch = "main"): Promise<void> {
	if (!existsSync(path)) {
		mkdirSync(path, { recursive: true });
	}
	const git = simpleGit(path);
	await git.init([`--initial-branch=${initialBranch}`]);
}

export async function getGitRoot(path: string): Promise<string | null> {
	try {
		const git = simpleGit(path);
		const root = await git.revparse(["--show-toplevel"]);
		return root.trim();
	} catch {
		return null;
	}
}

export async function isGitRepo(path: string): Promise<boolean> {
	return (await getGitRoot(path)) !== null;
}

export async function detectDefaultBranch(repoPath: string): Promise<string> {
	const git = simpleGit(repoPath);

	try {
		const ref = await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]);
		const branch = ref.trim().replace("refs/remotes/origin/", "");
		if (branch) return branch;
	} catch {
		// No remote or no HEAD set
	}

	try {
		const branches = await git.branchLocal();
		if (branches.all.includes("main")) return "main";
		if (branches.all.includes("master")) return "master";
		if (branches.current) return branches.current;
	} catch {
		// Empty repo, no branches
	}

	return "main";
}

export async function parseRemoteUrl(repoPath: string): Promise<RemoteInfo | null> {
	try {
		const git = simpleGit(repoPath);
		const remotes = await git.getRemotes(true);
		const origin = remotes.find((r) => r.name === "origin");
		if (!origin?.refs?.fetch) return null;
		return parseRemoteInfo(origin.refs.fetch);
	} catch {
		return null;
	}
}

export interface WorktreeInfo {
	path: string;
	branch: string;
	isMain: boolean;
}

export async function createWorktree(
	repoPath: string,
	worktreePath: string,
	branch: string,
	baseBranch: string
): Promise<void> {
	const git = simpleGit(repoPath);
	await git.raw(["worktree", "add", "-b", branch, worktreePath, baseBranch]);
}

export async function checkoutBranchWorktree(
	repoPath: string,
	worktreePath: string,
	branch: string
): Promise<void> {
	const git = simpleGit(repoPath);
	await git.fetch("origin", branch);
	await git.raw(["worktree", "add", worktreePath, branch]);
}

export async function removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.raw(["worktree", "remove", worktreePath, "--force"]);
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
	const git = simpleGit(repoPath);
	const output = await git.raw(["worktree", "list", "--porcelain"]);
	const worktrees: WorktreeInfo[] = [];
	let current: Partial<WorktreeInfo> = {};

	for (const line of output.split("\n")) {
		if (line.startsWith("worktree ")) {
			current.path = line.slice("worktree ".length);
		} else if (line.startsWith("branch refs/heads/")) {
			current.branch = line.slice("branch refs/heads/".length);
		} else if (line === "") {
			if (current.path && current.branch) {
				worktrees.push({
					path: current.path,
					branch: current.branch,
					isMain: worktrees.length === 0,
				});
			}
			current = {};
		}
	}

	return worktrees;
}

export async function listBranches(repoPath: string): Promise<string[]> {
	const git = simpleGit(repoPath);
	try {
		await git.fetch("origin");
	} catch {
		// No remote configured or unreachable — fall back to local branches only
	}
	const result = await git.branch(["-a"]);
	const branches = new Set<string>();
	for (const name of result.all) {
		if (name.includes("/HEAD")) continue;
		const clean = name.replace(/^remotes\/origin\//, "");
		branches.add(clean);
	}
	return [...branches].sort();
}

export function sortBranchesWithDefault(branches: string[], defaultBranch: string): string[] {
	const sorted = branches.filter((b) => b !== defaultBranch).sort();
	if (branches.includes(defaultBranch)) {
		sorted.unshift(defaultBranch);
	}
	return sorted;
}

export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
	const git = simpleGit(repoPath);
	const status = await git.raw(["status", "--porcelain"]);
	return status.trim().length > 0;
}

export async function getUntrackedFiles(repoPath: string): Promise<string[]> {
	const git = simpleGit(repoPath);
	// -uall lists individual files inside untracked directories
	// instead of just the directory name (default -unormal)
	const status = await git.raw(["status", "--porcelain", "-uall"]);
	return status
		.split("\n")
		.filter((line) => line.startsWith("?? "))
		.map((line) => line.slice(3).replace(/\/$/, ""));
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
	const git = simpleGit(repoPath);
	try {
		const branch = await git.raw(["rev-parse", "--abbrev-ref", "HEAD"]);
		return branch.trim();
	} catch {
		return "HEAD";
	}
}

export async function stageFiles(repoPath: string, paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	const git = simpleGit(repoPath);
	await git.add(paths);
}

export async function unstageFiles(repoPath: string, paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	const git = simpleGit(repoPath);
	await git.reset(["HEAD", "--", ...paths]);
}

export async function commitChanges(repoPath: string, message: string): Promise<{ hash: string }> {
	const git = simpleGit(repoPath);
	const result = await git.commit(message);
	return { hash: result.commit };
}

export async function pushBranch(repoPath: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.push();
}

export interface CommitInfo {
	hash: string;
	shortHash: string;
	message: string;
	time: string;
	additions: number;
	deletions: number;
	files: DiffFile[];
}

export async function getCommitsAhead(repoPath: string, baseBranch: string): Promise<CommitInfo[]> {
	const git = simpleGit(repoPath);

	// Get commits between base and HEAD
	const log = await git.log({
		from: baseBranch,
		to: "HEAD",
		format: { hash: "%H", shortHash: "%h", message: "%s", time: "%ar" },
	});

	const commits: CommitInfo[] = [];
	for (const entry of log.all) {
		// Get diff for each commit
		const rawDiff = await git.diff([`${entry.hash}~1..${entry.hash}`, "--unified=0", "--no-color"]);
		const files = parseUnifiedDiff(rawDiff);
		const additions = files.reduce((sum, f) => sum + f.additions, 0);
		const deletions = files.reduce((sum, f) => sum + f.deletions, 0);

		commits.push({
			hash: entry.hash,
			shortHash: entry.shortHash,
			message: entry.message,
			time: entry.time,
			additions,
			deletions,
			files,
		});
	}

	return commits;
}

export type { DiffLine, DiffHunk, DiffFile, DiffStats } from "../../shared/diff-types";
import type { DiffFile, DiffHunk, DiffLine } from "../../shared/diff-types";

export function parseUnifiedDiff(rawDiff: string): DiffFile[] {
	if (!rawDiff.trim()) return [];

	const files: DiffFile[] = [];
	const blocks = rawDiff.split(/^diff --git /m).filter(Boolean);

	for (const block of blocks) {
		const lines = block.split("\n");
		let lineIdx = 1; // skip the "a/... b/..." header line

		let status: DiffFile["status"] = "modified";
		let filePath = "";
		let oldFilePath: string | undefined;

		// Read file metadata until --- or @@
		while (lineIdx < lines.length) {
			const line = lines[lineIdx] ?? "";
			if (line.startsWith("new file mode")) {
				status = "added";
			} else if (line.startsWith("deleted file mode")) {
				status = "deleted";
			} else if (line.startsWith("rename from ")) {
				oldFilePath = line.slice("rename from ".length);
				status = "renamed";
			} else if (line.startsWith("rename to ")) {
				filePath = line.slice("rename to ".length);
			} else if (line.startsWith("Binary files")) {
				status = "binary";
			} else if (line.startsWith("--- ")) {
				const p = line.slice(4);
				if (p !== "/dev/null") {
					oldFilePath = p.startsWith("a/") ? p.slice(2) : p;
				}
			} else if (line.startsWith("+++ ")) {
				const p = line.slice(4);
				if (p === "/dev/null") {
					filePath = oldFilePath ?? "";
				} else {
					filePath = p.startsWith("b/") ? p.slice(2) : p;
				}
			} else if (line.startsWith("@@")) {
				break;
			}
			lineIdx++;
		}

		const hunks: DiffHunk[] = [];
		let additions = 0;
		let deletions = 0;

		while (lineIdx < lines.length) {
			const line = lines[lineIdx] ?? "";
			if (!line.startsWith("@@")) {
				lineIdx++;
				continue;
			}

			const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
			if (!hunkMatch) {
				lineIdx++;
				continue;
			}

			const oldStart = Number.parseInt(hunkMatch[1] ?? "1", 10);
			const oldLineCount = Number.parseInt(hunkMatch[2] ?? "1", 10);
			const newStart = Number.parseInt(hunkMatch[3] ?? "1", 10);
			const newLineCount = Number.parseInt(hunkMatch[4] ?? "1", 10);
			lineIdx++;

			const hunkLines: DiffLine[] = [];
			let oldNum = oldStart;
			let newNum = newStart;

			while (lineIdx < lines.length) {
				const diffLine = lines[lineIdx] ?? "";
				if (diffLine.startsWith("@@") || diffLine.startsWith("diff --git")) break;
				if (diffLine.startsWith("+")) {
					hunkLines.push({ type: "added", content: diffLine.slice(1), newLineNumber: newNum++ });
					additions++;
				} else if (diffLine.startsWith("-")) {
					hunkLines.push({ type: "removed", content: diffLine.slice(1), oldLineNumber: oldNum++ });
					deletions++;
				} else if (diffLine.startsWith(" ")) {
					// context line — explicitly space-prefixed
					hunkLines.push({
						type: "context",
						content: diffLine.slice(1),
						oldLineNumber: oldNum++,
						newLineNumber: newNum++,
					});
				}
				// skip backslash lines (e.g. "\ No newline at end of file") and blank separators
				lineIdx++;
			}

			hunks.push({
				header: line,
				oldStart,
				oldLines: oldLineCount,
				newStart,
				newLines: newLineCount,
				lines: hunkLines,
			});
		}

		if (filePath) {
			files.push({
				path: filePath,
				oldPath: status === "renamed" ? oldFilePath : undefined,
				status,
				additions,
				deletions,
				hunks,
			});
		}
	}

	return files;
}

export { detectLanguage } from "../../shared/diff-types";
