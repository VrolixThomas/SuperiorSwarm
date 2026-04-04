import { existsSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { BranchInfo, BranchStatus } from "../../shared/branch-types";
import { resolveGitDir } from "./operations";

async function getAheadBehind(
	git: ReturnType<typeof simpleGit>,
	local: string,
	remote: string
): Promise<{ ahead: number; behind: number }> {
	try {
		const raw = await git.raw(["rev-list", "--left-right", "--count", `${local}...${remote}`]);
		const parts = raw.trim().split(/\s+/);
		return {
			ahead: Number.parseInt(parts[0] ?? "0", 10),
			behind: Number.parseInt(parts[1] ?? "0", 10),
		};
	} catch {
		return { ahead: 0, behind: 0 };
	}
}

export async function checkoutBranch(repoPath: string, branch: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.checkout(branch);
}

export async function createBranch(
	repoPath: string,
	name: string,
	baseBranch: string
): Promise<void> {
	const git = simpleGit(repoPath);
	await git.branch([name, baseBranch]);
}

export async function deleteBranch(repoPath: string, name: string, force: boolean): Promise<void> {
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
	newName: string
): Promise<void> {
	const git = simpleGit(repoPath);
	await git.branch(["-m", oldName, newName]);
}

export async function getBranchStatus(repoPath: string): Promise<BranchStatus> {
	const git = simpleGit(repoPath);
	const status = await git.status();
	const branch = status.current ?? "HEAD";
	const tracking = status.tracking || null;

	const { ahead, behind } = tracking
		? await getAheadBehind(git, branch, tracking)
		: { ahead: 0, behind: 0 };

	const gitDir = await resolveGitDir(repoPath);
	let state: BranchStatus["state"] = "clean";
	if (existsSync(join(gitDir, "MERGE_HEAD"))) {
		state = "merging";
	} else if (existsSync(join(gitDir, "rebase-merge")) || existsSync(join(gitDir, "rebase-apply"))) {
		state = "rebasing";
	} else if (existsSync(join(gitDir, "CHERRY_PICK_HEAD"))) {
		state = "cherry-picking";
	}

	return { branch, tracking, ahead, behind, state };
}

export async function listBranchesDetailed(
	repoPath: string,
	defaultBranch: string,
	cwd?: string
): Promise<BranchInfo[]> {
	const git = simpleGit(repoPath);
	const result = await git.branch(["-a", "-vv"]);

	// Determine current branch from the CWD context (worktree), not the main repo
	let current = result.current;
	if (cwd && cwd !== repoPath) {
		try {
			const cwdGit = simpleGit(cwd);
			const cwdStatus = await cwdGit.status();
			current = cwdStatus.current ?? "HEAD";
		} catch {
			// Fall back to main repo's current
		}
	}

	const localSet = new Set<string>();
	const remoteSet = new Set<string>();
	const trackingMap = new Map<string, string>(); // local name → remote tracking ref
	const aheadBehindMap = new Map<string, { ahead: number; behind: number }>();

	for (const [name, info] of Object.entries(result.branches)) {
		if (name.includes("/HEAD")) continue;

		if (name.startsWith("remotes/origin/")) {
			const clean = name.replace(/^remotes\/origin\//, "");
			remoteSet.add(clean);
		} else {
			localSet.add(name);
			// Parse tracking info from the label field (e.g. "[origin/main: ahead 2, behind 1]")
			const label = info.label ?? "";
			const trackMatch = label.match(/\[([^\]:]+)/);
			if (trackMatch) {
				trackingMap.set(name, trackMatch[1]);
			}
		}
	}

	await Promise.all(
		[...trackingMap].map(async ([localName, tracking]) => {
			const ab = await getAheadBehind(git, localName, tracking);
			if (ab.ahead !== 0 || ab.behind !== 0) {
				aheadBehindMap.set(localName, ab);
			}
		})
	);

	// Build unified branch list
	const allNames = new Set([...localSet, ...remoteSet]);
	const branches: BranchInfo[] = [];

	for (const name of allNames) {
		const isLocal = localSet.has(name);
		const isRemote = remoteSet.has(name);
		const ab = aheadBehindMap.get(name);

		branches.push({
			name,
			isLocal,
			isRemote,
			tracking: trackingMap.get(name) ?? null,
			lastCommit: null, // Populated lazily if needed
			hasWorkspace: false, // Set by the caller (renderer)
			isDefault: name === defaultBranch,
			isCurrent: name === current,
			ahead: ab?.ahead ?? 0,
			behind: ab?.behind ?? 0,
		});
	}

	// Sort: default first, then current, then alphabetical
	branches.sort((a, b) => {
		if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
		if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
		return a.name.localeCompare(b.name);
	});

	return branches;
}

export async function getBranchInfo(
	repoPath: string,
	branchName: string
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
		tracking = (await git.raw(["config", "--get", `branch.${branchName}.merge`])).trim() || null;
		if (tracking) {
			const remote = (await git.raw(["config", "--get", `branch.${branchName}.remote`])).trim();
			const remoteBranch = `${remote}/${tracking.replace("refs/heads/", "")}`;
			const ab = await getAheadBehind(git, branchName, remoteBranch);
			ahead = ab.ahead;
			behind = ab.behind;
			tracking = remoteBranch;
		}
	} catch {
		// No tracking configured
	}

	return { lastCommit, tracking, ahead, behind };
}
