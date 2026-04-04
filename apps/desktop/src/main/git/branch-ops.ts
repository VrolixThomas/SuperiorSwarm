import { existsSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { BranchStatus } from "../../shared/branch-types";

export async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.checkout(branch);
}

export async function createBranch(
	repoPath: string,
	name: string,
	baseBranch: string,
): Promise<void> {
	const git = simpleGit(repoPath);
	await git.checkoutBranch(name, baseBranch);
	await git.checkout(baseBranch);
}

export async function deleteBranch(
	repoPath: string,
	name: string,
	force: boolean,
): Promise<void> {
	const git = simpleGit(repoPath);
	if (force) {
		await git.branch(["-D", name]);
	} else {
		await git.branch(["-d", name]);
	}
}

export async function renameBranch(
	repoPath: string,
	oldName: string,
	newName: string,
): Promise<void> {
	const git = simpleGit(repoPath);
	await git.branch(["-m", oldName, newName]);
}

export async function getBranchStatus(repoPath: string): Promise<BranchStatus> {
	const git = simpleGit(repoPath);
	const status = await git.status();
	const branch = status.current ?? "HEAD";
	const tracking = status.tracking || null;

	let ahead = 0;
	let behind = 0;

	if (tracking) {
		try {
			const result = await git.raw([
				"rev-list",
				"--left-right",
				"--count",
				`${branch}...${tracking}`,
			]);
			const parts = result.trim().split(/\s+/);
			ahead = parseInt(parts[0] ?? "0", 10);
			behind = parseInt(parts[1] ?? "0", 10);
		} catch {
			// No tracking branch or upstream gone
		}
	}

	let state: BranchStatus["state"] = "clean";
	if (existsSync(join(repoPath, ".git", "MERGE_HEAD"))) {
		state = "merging";
	} else if (
		existsSync(join(repoPath, ".git", "rebase-merge")) ||
		existsSync(join(repoPath, ".git", "rebase-apply"))
	) {
		state = "rebasing";
	} else if (existsSync(join(repoPath, ".git", "CHERRY_PICK_HEAD"))) {
		state = "cherry-picking";
	}

	return { branch, tracking, ahead, behind, state };
}

export async function getBranchInfo(
	repoPath: string,
	branchName: string,
): Promise<{
	lastCommit: { hash: string; message: string; date: string; author: string } | null;
	tracking: string | null;
	ahead: number;
	behind: number;
}> {
	const git = simpleGit(repoPath);

	let lastCommit = null;
	try {
		const log = await git.log({ maxCount: 1, from: branchName });
		const entry = log.latest;
		if (entry) {
			lastCommit = {
				hash: entry.hash,
				message: entry.message,
				date: entry.date,
				author: entry.author_name,
			};
		}
	} catch {
		// Branch may not have commits
	}

	let tracking: string | null = null;
	let ahead = 0;
	let behind = 0;

	try {
		tracking =
			(await git.raw(["config", "--get", `branch.${branchName}.merge`])).trim() || null;
		if (tracking) {
			const remote = (
				await git.raw(["config", "--get", `branch.${branchName}.remote`])
			).trim();
			const remoteBranch = `${remote}/${tracking.replace("refs/heads/", "")}`;
			const result = await git.raw([
				"rev-list",
				"--left-right",
				"--count",
				`${branchName}...${remoteBranch}`,
			]);
			const parts = result.trim().split(/\s+/);
			ahead = parseInt(parts[0] ?? "0", 10);
			behind = parseInt(parts[1] ?? "0", 10);
			tracking = remoteBranch;
		}
	} catch {
		// No tracking configured
	}

	return { lastCommit, tracking, ahead, behind };
}
