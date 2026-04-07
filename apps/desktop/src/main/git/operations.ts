import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
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

/** Resolve the actual .git directory, works for both normal repos and worktrees. */
export async function resolveGitDir(repoPath: string): Promise<string> {
	const git = simpleGit(repoPath);
	const raw = await git.revparse(["--git-dir"]);
	return resolve(repoPath, raw.trim());
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

	// Single `git log --raw --numstat` call replaces the previous N-per-commit
	// `git diff` fan-out. Hunks are omitted intentionally — see parseCommitsAhead
	// below for the rationale.
	const raw = await git.raw([
		"log",
		`${baseBranch}..HEAD`,
		"--raw",
		"--numstat",
		"-M",
		"--no-color",
		"--format=__C__|%H|%h|%ar|%s",
	]);

	return parseCommitsAhead(raw);
}

/**
 * Parse the combined `git log --raw --numstat --format=__C__|...` output into
 * `CommitInfo[]`. Pure function — exported so the parsing logic is unit-tested
 * independently of `simple-git`.
 *
 * Output shape produced by `git log <base>..HEAD --raw --numstat -M
 * --no-color --format=__C__|%H|%h|%ar|%s`:
 *
 *   __C__|<hash>|<shortHash>|<relTime>|<subject>
 *   <blank>
 *   :<srcMode> <dstMode> <srcSha> <dstSha> <STATUS>\t<path>          (raw)
 *   :<srcMode> <dstMode> <srcSha> <dstSha> R<score>\t<old>\t<new>    (rename)
 *   <adds>\t<dels>\t<path>                                          (numstat)
 *   -\t-\t<path>                                                    (binary)
 *
 * The raw block lists files first (one line per file), then the numstat block
 * lists the same files (one line per file). We build the file array from the
 * raw block (which is the only place rename old→new survives), index the
 * numstat additions/deletions by path, then merge.
 *
 * Status letters mapped to the renderer's `STATUS_DOT_COLORS` palette
 * (see `apps/desktop/src/renderer/components/CommittedStack.tsx:7`):
 *   A → "added", D → "deleted", M → "modified", R → "renamed",
 *   C/T/anything else → "modified" (the renderer doesn't have a colour for
 *   copies or type-changes; collapsing to "modified" preserves the dot).
 *
 * Hunks are intentionally `[]` — `CommitCard` and `PRCommitCard` never read
 * them, and including them was the cause of the 2026-04-07 PR-rail freeze
 * (see docs/superpowers/plans/2026-04-07-commits-ahead-payload-fix.md).
 */
export function parseCommitsAhead(raw: string): CommitInfo[] {
	const commits: CommitInfo[] = [];
	let current: CommitInfo | null = null;
	let numstatByPath: Map<string, { additions: number; deletions: number }> | null = null;

	const finalize = () => {
		if (!current || !numstatByPath) return;
		for (const file of current.files) {
			const stat = numstatByPath.get(file.path);
			if (!stat) continue;
			file.additions = stat.additions;
			file.deletions = stat.deletions;
			current.additions += stat.additions;
			current.deletions += stat.deletions;
		}
	};

	for (const line of raw.split("\n")) {
		if (line.startsWith("__C__|")) {
			finalize();
			const parts = line.slice("__C__|".length).split("|");
			const [hash = "", shortHash = "", time = "", ...messageParts] = parts;
			current = {
				hash,
				shortHash,
				message: messageParts.join("|"),
				time,
				additions: 0,
				deletions: 0,
				files: [],
			};
			numstatByPath = new Map();
			commits.push(current);
			continue;
		}
		if (!current || !numstatByPath) continue;
		if (!line.trim()) continue;

		if (line.startsWith(":")) {
			// Raw line: ":<modes...> <STATUS>\t<path>" or rename:
			// "...R<score>\t<old>\t<new>". The status token is the last
			// whitespace-separated field of the header (everything before
			// the first tab) — its first character is the status letter
			// (R/C may carry a similarity score, e.g. "R100").
			const tabSplit = line.split("\t");
			const header = tabSplit[0] ?? "";
			const headerTokens = header.split(/\s+/);
			const statusToken = headerTokens[headerTokens.length - 1] ?? "";
			const statusChar = statusToken.charAt(0);
			const file: DiffFile = {
				path: "",
				status: "modified",
				additions: 0,
				deletions: 0,
				hunks: [],
			};
			if (statusChar === "A") {
				file.status = "added";
				file.path = tabSplit[1] ?? "";
			} else if (statusChar === "D") {
				file.status = "deleted";
				file.path = tabSplit[1] ?? "";
			} else if (statusChar === "M") {
				file.status = "modified";
				file.path = tabSplit[1] ?? "";
			} else if (statusChar === "R") {
				file.status = "renamed";
				file.oldPath = tabSplit[1];
				file.path = tabSplit[2] ?? "";
			} else if (statusChar === "C") {
				file.status = "modified";
				file.path = tabSplit[2] ?? "";
			} else {
				file.status = "modified";
				file.path = tabSplit[1] ?? "";
			}

			if (file.path) current.files.push(file);
			continue;
		}

		// Numstat line: "<adds>\t<dels>\t<path>" — binary uses "-\t-\t<path>",
		// renames may use "0\t0\t<old> => <new>" or compact `{old => new}`.
		const tabs = line.split("\t");
		if (tabs.length < 3) continue;
		const addStr = tabs[0] ?? "";
		const delStr = tabs[1] ?? "";
		const rawPath = tabs.slice(2).join("\t");
		const additions = addStr === "-" ? 0 : Number.parseInt(addStr, 10) || 0;
		const deletions = delStr === "-" ? 0 : Number.parseInt(delStr, 10) || 0;

		// Normalise rename paths so they line up with the raw block's path.
		// `--raw -M` puts the new path in the raw entry, so we want the same
		// here. Compact `{old => new}` collapses to `new`; bare `old => new`
		// also collapses to `new`.
		const renameMatch = rawPath.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
		let path = rawPath;
		if (renameMatch) {
			const [, prefix = "", , newPart = "", suffix = ""] = renameMatch;
			path = `${prefix}${newPart}${suffix}`.replace(/\/\//g, "/");
		} else if (rawPath.includes(" => ")) {
			path = rawPath.split(" => ")[1] ?? rawPath;
		}

		numstatByPath.set(path, { additions, deletions });
	}

	finalize();
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
