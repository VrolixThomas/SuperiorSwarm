import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveWorkspaceFilePath } from "./file-path";

export async function readWorkspaceFile(root: string, path: string): Promise<string> {
	const full = await resolveWorkspaceFilePath(root, path);
	const handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		if (!(await handle.stat()).isFile()) throw new Error("A regular file is required");
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

export async function saveWorkspaceFile(
	root: string,
	path: string,
	content: string
): Promise<void> {
	const full = await resolveWorkspaceFilePath(root, path, { allowMissing: true });
	await mkdir(dirname(full), { recursive: true });
	await resolveWorkspaceFilePath(root, path, { allowMissing: true });
	const handle = await open(
		full,
		constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
		0o600
	);
	try {
		if (!(await handle.stat()).isFile()) throw new Error("A regular file is required");
		await handle.truncate(0);
		await handle.writeFile(content, "utf8");
	} finally {
		await handle.close();
	}
}
