import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import simpleGit from "simple-git";
import type {
	ConflictContent,
	ConflictFile,
	ConflictType,
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

	// Auto-staged files that git cleanly resolved are NOT included — they don't
	// need manual resolution and previously caused the conflict count to balloon.
	return status.conflicted
		.map((path): ConflictFile => ({ path, status: "conflicting" }))
		.sort((a, b) => a.path.localeCompare(b.path));
}

export async function getConflictContent(
	repoPath: string,
	filePath: string
): Promise<ConflictContent> {
	const git = simpleGit(repoPath);

	// Determine which index stages actually exist for this path so we can
	// classify the conflict type and avoid silently swallowing missing-stage errors.
	const unmergedRaw = await git.raw(["ls-files", "--unmerged", "--", filePath]).catch(() => "");
	const presentStages = new Set<number>();
	for (const line of unmergedRaw.split("\n")) {
		const m = line.match(/^\d+ \w+ (\d)\t/);
		if (m) presentStages.add(Number(m[1]));
	}

	const has1 = presentStages.has(1);
	const has2 = presentStages.has(2);
	const has3 = presentStages.has(3);

	let conflictType: ConflictType;
	if (has1 && has2 && has3) conflictType = "modify/modify";
	else if (!has1 && has2 && has3) conflictType = "add/add";
	else if (has1 && has2 && !has3) conflictType = "modify/delete";
	else if (has1 && !has2 && has3) conflictType = "delete/modify";
	else if (!has1 && has2 && !has3) conflictType = "add/delete";
	else if (!has1 && !has2 && has3) conflictType = "delete/add";
	else conflictType = "unknown";

	const [base, ours, theirs] = await Promise.all([
		has1 ? git.show([`:1:${filePath}`]).catch(() => "") : Promise.resolve(""),
		has2 ? git.show([`:2:${filePath}`]).catch(() => "") : Promise.resolve(""),
		has3 ? git.show([`:3:${filePath}`]).catch(() => "") : Promise.resolve(""),
	]);

	return { base, ours, theirs, conflictType };
}

export async function markFileResolved(
	repoPath: string,
	filePath: string,
	resolvedContent: string
): Promise<void> {
	const base = resolve(repoPath);
	const fullPath = resolve(repoPath, filePath);
	if (!fullPath.startsWith(`${base}/`) && fullPath !== base) {
		throw new Error(`Path traversal attempt: ${filePath}`);
	}
	await writeFile(fullPath, resolvedContent, "utf-8");
	const git = simpleGit(repoPath);
	await git.add(filePath);
}
