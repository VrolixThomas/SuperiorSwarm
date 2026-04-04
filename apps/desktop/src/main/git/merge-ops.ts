import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import type {
	ConflictContent,
	ConflictFile,
	MergeResult,
	RebaseResult,
} from "../../shared/branch-types";
import { resolveGitDir } from "./operations";

export async function mergeBranch(repoPath: string, branch: string): Promise<MergeResult> {
	const git = simpleGit(repoPath);
	try {
		await git.merge([branch]);
		return { status: "ok" };
	} catch (err) {
		const gitDir = await resolveGitDir(repoPath);
		if (existsSync(join(gitDir, "MERGE_HEAD"))) {
			const files = await getConflictingFiles(repoPath);
			return { status: "conflict", files: files.map((f) => f.path) };
		}
		throw err;
	}
}

export async function abortMerge(repoPath: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.merge(["--abort"]);
}

export async function rebaseBranch(repoPath: string, ontoBranch: string): Promise<RebaseResult> {
	const git = simpleGit(repoPath);
	try {
		await git.rebase([ontoBranch]);
		return { status: "ok" };
	} catch {
		const gitDir = await resolveGitDir(repoPath);
		const rebaseMergeDir = join(gitDir, "rebase-merge");
		const rebaseApplyDir = join(gitDir, "rebase-apply");
		if (existsSync(rebaseMergeDir) || existsSync(rebaseApplyDir)) {
			const files = await getConflictingFiles(repoPath);
			const progress = await getRebaseProgress(repoPath);
			return { status: "conflict", files: files.map((f) => f.path), progress };
		}
		throw new Error("Rebase failed");
	}
}

export async function abortRebase(repoPath: string): Promise<void> {
	const git = simpleGit(repoPath);
	await git.rebase(["--abort"]);
}

export async function continueRebase(repoPath: string): Promise<RebaseResult> {
	const git = simpleGit(repoPath);
	try {
		await git.rebase(["--continue"]);
		return { status: "ok" };
	} catch {
		const gitDir = await resolveGitDir(repoPath);
		const rebaseMergeDir = join(gitDir, "rebase-merge");
		if (existsSync(rebaseMergeDir)) {
			const files = await getConflictingFiles(repoPath);
			const progress = await getRebaseProgress(repoPath);
			return { status: "conflict", files: files.map((f) => f.path), progress };
		}
		throw new Error("Rebase continue failed");
	}
}

export async function getRebaseProgress(
	repoPath: string
): Promise<{ current: number; total: number } | undefined> {
	const gitDir = await resolveGitDir(repoPath);
	const rebaseMergeDir = join(gitDir, "rebase-merge");
	try {
		const current = Number.parseInt(
			readFileSync(join(rebaseMergeDir, "msgnum"), "utf-8").trim(),
			10
		);
		const total = Number.parseInt(readFileSync(join(rebaseMergeDir, "end"), "utf-8").trim(), 10);
		return { current, total };
	} catch {
		return undefined;
	}
}

export async function getConflictingFiles(repoPath: string): Promise<ConflictFile[]> {
	const git = simpleGit(repoPath);
	const status = await git.status();

	const conflicted = new Set(status.conflicted);
	const staged = new Set(status.staged);

	const allFiles = new Set([...status.conflicted, ...status.staged]);
	const files: ConflictFile[] = [];

	for (const path of allFiles) {
		if (conflicted.has(path)) {
			files.push({ path, status: "conflicting" });
		} else if (staged.has(path)) {
			files.push({ path, status: "resolved" });
		}
	}

	return files.sort((a, b) => {
		if (a.status !== b.status) return a.status === "conflicting" ? -1 : 1;
		return a.path.localeCompare(b.path);
	});
}

export async function getConflictContent(
	repoPath: string,
	filePath: string
): Promise<ConflictContent> {
	const git = simpleGit(repoPath);

	const [base, ours, theirs] = await Promise.all([
		git.show([`:1:${filePath}`]).catch(() => ""),
		git.show([`:2:${filePath}`]).catch(() => ""),
		git.show([`:3:${filePath}`]).catch(() => ""),
	]);

	return { base, ours, theirs };
}

export async function markFileResolved(
	repoPath: string,
	filePath: string,
	resolvedContent: string
): Promise<void> {
	const fullPath = join(repoPath, filePath);
	writeFileSync(fullPath, resolvedContent, "utf-8");
	const git = simpleGit(repoPath);
	await git.add(filePath);
}
