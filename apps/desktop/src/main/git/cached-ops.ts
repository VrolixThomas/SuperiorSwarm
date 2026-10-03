import simpleGit from "simple-git";
import type { DiffFile } from "../../shared/diff-types";
import { isExcludedBrowserEntry } from "../../shared/file-browser-policy";
import { getBranchStatus } from "./branch-ops";
import { createGitCache } from "./git-cache";
import {
	getCommitsAhead,
	getCurrentBranch,
	getUntrackedFiles,
	parseUnifiedDiff,
	resolveFurthestBranchRef,
} from "./operations";
import { getRepoStateVersion } from "./repo-state-version";

const branchDiffCache = createGitCache<{
	files: ReturnType<typeof parseUnifiedDiff>;
	stats: { added: number; removed: number; changed: number };
	baseRef: string;
	mergeBase: string;
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
		const baseRef = await resolveFurthestBranchRef(input.repoPath, input.baseBranch, false);
		const mergeBase = await git
			.raw(["merge-base", baseRef, input.headBranch])
			.then((r) => r.trim())
			.catch(() => baseRef);
		const rawDiff = await git.diff([
			`${mergeBase}..${input.headBranch}`,
			"--unified=3",
			"--no-color",
		]);
		const files = parseUnifiedDiff(rawDiff);
		return { files, stats: computeStats(files), baseRef, mergeBase };
	});
}

export async function getWorkingTreeStatusCached(input: {
	repoPath: string;
	metadataOnly?: boolean;
}) {
	const key = `wt-status:${input.repoPath}:${input.metadataOnly ? "metadata" : "diff"}`;
	return workingTreeStatusCache.get(key, getRepoStateVersion(input.repoPath), async () => {
		const git = simpleGit(input.repoPath);
		if (input.metadataOnly) {
			// The Files browser needs decoration metadata, never patches or file contents.
			const status = await git.status(["--untracked-files=normal"]);
			const stagedFiles: DiffFile[] = [];
			const unstagedFiles: DiffFile[] = [];
			for (const file of status.files) {
				const parts = file.path.split("/");
				if (parts.some((part, index) => isExcludedBrowserEntry(part, index < parts.length - 1)))
					continue;
				const entry = (code: string): DiffFile => ({
					path: file.path,
					status:
						code === "D"
							? "deleted"
							: code === "R"
								? "renamed"
								: code === "A" || code === "?"
									? "added"
									: "modified",
					additions: 0,
					deletions: 0,
					hunks: [],
				});
				if (file.index.trim() && file.index !== "?") stagedFiles.push(entry(file.index));
				if (file.working_dir.trim()) unstagedFiles.push(entry(file.working_dir));
			}
			return { stagedFiles, unstagedFiles, branch: status.current ?? "" };
		}
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
	return commitsAheadCache.get(key, getRepoStateVersion(input.repoPath), async () => {
		const baseRef = await resolveFurthestBranchRef(input.repoPath, input.baseBranch, false);
		return getCommitsAhead(input.repoPath, baseRef);
	});
}

export async function getBranchStatusCached(repoPath: string) {
	const key = `branch-status:${repoPath}`;
	return branchStatusCache.get(key, getRepoStateVersion(repoPath), () => getBranchStatus(repoPath));
}
