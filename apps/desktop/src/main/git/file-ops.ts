import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readWorkingTreeFile(repoPath: string, filePath: string): Promise<string> {
	const fullPath = join(repoPath, filePath);
	try {
		return await readFile(fullPath, "utf-8");
	} catch {
		return "";
	}
}

export async function saveWorkingTreeFile(
	repoPath: string,
	filePath: string,
	content: string,
): Promise<void> {
	const fullPath = join(repoPath, filePath);
	await mkdir(dirname(fullPath), { recursive: true });
	await writeFile(fullPath, content, "utf-8");
}
