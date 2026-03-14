import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function safeResolve(repoPath: string, filePath: string): string {
	const base = resolve(repoPath);
	const full = resolve(repoPath, filePath);
	if (!full.startsWith(`${base}/`) && full !== base) {
		throw new Error(`Path traversal attempt: ${filePath}`);
	}
	return full;
}

export async function readWorkingTreeFile(repoPath: string, filePath: string): Promise<string> {
	const fullPath = safeResolve(repoPath, filePath);
	try {
		return await readFile(fullPath, "utf-8");
	} catch {
		return "";
	}
}

export async function saveWorkingTreeFile(
	repoPath: string,
	filePath: string,
	content: string
): Promise<void> {
	const fullPath = safeResolve(repoPath, filePath);
	await mkdir(dirname(fullPath), { recursive: true });
	await writeFile(fullPath, content, "utf-8");
}

export async function createDirectory(repoPath: string, dirPath: string): Promise<void> {
	const fullPath = safeResolve(repoPath, dirPath);
	await mkdir(fullPath, { recursive: true });
}

export async function deleteFile(repoPath: string, filePath: string): Promise<void> {
	const fullPath = safeResolve(repoPath, filePath);
	await rm(fullPath, { recursive: true });
}

export async function renameFile(
	repoPath: string,
	oldPath: string,
	newPath: string
): Promise<void> {
	const fullOld = safeResolve(repoPath, oldPath);
	const fullNew = safeResolve(repoPath, newPath);
	await mkdir(dirname(fullNew), { recursive: true });
	await rename(fullOld, fullNew);
}
