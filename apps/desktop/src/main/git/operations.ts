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

export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
	const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
	if (httpsMatch) {
		return { owner: httpsMatch[1], repo: httpsMatch[2] };
	}
	const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
	if (sshMatch) {
		return { owner: sshMatch[1], repo: sshMatch[2] };
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
	const git = simpleGit();
	const options: Record<string, null> = { "--progress": null };

	if (onProgress) {
		await git.clone(url, targetPath, options, {
			progress(event: SimpleGitProgressEvent) {
				onProgress({
					stage: event.stage,
					progress: event.progress,
					processed: event.processed,
					total: event.total,
				});
			},
		});
	} else {
		await git.clone(url, targetPath, options);
	}
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
): Promise<{ owner: string; repo: string } | null> {
	try {
		const git = simpleGit(repoPath);
		const remotes = await git.getRemotes(true);
		const origin = remotes.find((r) => r.name === "origin");
		if (!origin?.refs?.fetch) return null;
		return parseGitHubUrl(origin.refs.fetch);
	} catch {
		return null;
	}
}
