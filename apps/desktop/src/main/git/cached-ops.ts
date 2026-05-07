import simpleGit from "simple-git";
import { getBranchStatus } from "./branch-ops";
import { createGitCache } from "./git-cache";
import {
	getCommitsAhead,
	getCurrentBranch,
	getUntrackedFiles,
	parseUnifiedDiff,
} from "./operations";
import { getRepoStateVersion } from "./repo-state-version";

const branchDiffCache = createGitCache<{
	files: ReturnType<typeof parseUnifiedDiff>;
	stats: { added: number; removed: number; changed: number };
}>();

const workingTreeStatusCache = createGitCache<{
	stagedFiles: ReturnType<typeof parseUnifiedDiff>;
	unstagedFiles: ReturnType<typeof parseUnifiedDiff>;
	branch: string;
}>();

const commitsAheadCache = createGitCache<Awaited<ReturnType<typeof getCommitsAhead>>>();
const branchStatusCache = createGitCache<Awaited<ReturnType<typeof getBranchStatus>>>();

function computeStats(files: ReturnType<typeof parseUnifiedDiff>) {
	return {
		added: files.filter((f) => f.status === "added").length,
		removed: files.filter((f) => f.status === "deleted").length,
		changed: files.filter((f) => f.status !== "added" && f.status !== "deleted").length,
	};
}

export async function getBranchDiffCached(input: {
	repoPath: string;
	baseBranch: string;
	headBranch: string;
}) {
	const key = `branch-diff:${input.repoPath}:${input.baseBranch}:${input.headBranch}`;
	return branchDiffCache.get(key, getRepoStateVersion(input.repoPath), async () => {
		const git = simpleGit(input.repoPath);
		const mergeBase = await git
			.raw(["merge-base", input.baseBranch, input.headBranch])
			.then((r) => r.trim())
			.catch(() => input.baseBranch);
		const rawDiff = await git.diff([
			`${mergeBase}..${input.headBranch}`,
			"--unified=3",
			"--no-color",
		]);
		const files = parseUnifiedDiff(rawDiff);
		return { files, stats: computeStats(files) };
	});
}

export async function getWorkingTreeStatusCached(input: { repoPath: string }) {
	const key = `wt-status:${input.repoPath}`;
	return workingTreeStatusCache.get(key, getRepoStateVersion(input.repoPath), async () => {
		const git = simpleGit(input.repoPath);
		const [stagedRaw, unstagedRaw, untrackedPaths, branch] = await Promise.all([
			git.diff(["--cached", "--unified=3", "--no-color"]),
			git.diff(["--unified=3", "--no-color"]),
			getUntrackedFiles(input.repoPath),
			getCurrentBranch(input.repoPath),
		]);
		const stagedFiles = parseUnifiedDiff(stagedRaw);
		const unstagedFiles = parseUnifiedDiff(unstagedRaw);
		for (const filePath of untrackedPaths) {
			unstagedFiles.push({
				path: filePath,
				status: "added",
				additions: 0,
				deletions: 0,
				hunks: [],
			});
		}
		return { stagedFiles, unstagedFiles, branch };
	});
}

export async function getCommitsAheadCached(input: { repoPath: string; baseBranch: string }) {
	const key = `commits-ahead:${input.repoPath}:${input.baseBranch}`;
	return commitsAheadCache.get(key, getRepoStateVersion(input.repoPath), () =>
		getCommitsAhead(input.repoPath, input.baseBranch)
	);
}

export async function getBranchStatusCached(repoPath: string) {
	const key = `branch-status:${repoPath}`;
	return branchStatusCache.get(key, getRepoStateVersion(repoPath), () => getBranchStatus(repoPath));
}
