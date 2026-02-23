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

export async function parseRemoteUrl(
	repoPath: string
): Promise<RemoteInfo | null> {
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
	const result = await git.branchLocal();
	return result.all;
}

export async function hasUncommittedChanges(repoPath: string): Promise<boolean> {
	const git = simpleGit(repoPath);
	const status = await git.raw(["status", "--porcelain"]);
	return status.trim().length > 0;
}
