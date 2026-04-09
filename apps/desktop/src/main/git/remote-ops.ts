import simpleGit from "simple-git";
import type { MergeResult } from "../../shared/branch-types";

export async function push(repoPath: string, branch?: string): Promise<void> {
	const git = simpleGit(repoPath);
	const targetBranch = branch ?? (await git.status()).current ?? "";
	await git.push("origin", targetBranch, ["--set-upstream"]);
}

export async function pull(repoPath: string): Promise<MergeResult> {
	const git = simpleGit(repoPath);
	try {
		await git.pull();
		return { status: "ok" };
	} catch {
		const status = await git.status();
		if (status.conflicted.length > 0) {
			return { status: "conflict", files: status.conflicted };
		}
		throw new Error("Pull failed");
	}
}

export async function fetchAll(repoPath: string): Promise<void> {
	const git = simpleGit(repoPath);
	try {
		await git.fetch(["--all", "--prune"]);
	} catch {
		// No remotes configured — silently succeed
	}
}
