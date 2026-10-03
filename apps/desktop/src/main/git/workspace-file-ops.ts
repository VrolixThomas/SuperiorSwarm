import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkspaceFileContent } from "../../shared/file-browser-types";
import { resolveWorkspaceFilePath } from "./file-path";

async function resolveEditorFile(root: string, path: string, allowMissing = false) {
	const full = await resolveWorkspaceFilePath(root, path, { allowMissing, allowLeafSymlink: true });
	const entry = await lstat(full).catch((error: NodeJS.ErrnoException) => {
		if (allowMissing && error.code === "ENOENT") return null;
		throw error;
	});
	if (!entry?.isSymbolicLink()) return { full, symlinkTarget: undefined };
	const target = await realpath(full);
	if (!(await lstat(target)).isFile())
		throw new Error("The symbolic link must target a regular file");
	return { full: target, symlinkTarget: target };
}

export async function readWorkspaceFile(root: string, path: string): Promise<WorkspaceFileContent> {
	const target = await resolveEditorFile(root, path);
	const handle = await open(
		target.full,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
	);
	try {
		if (!(await handle.stat()).isFile()) throw new Error("A regular file is required");
		return { content: await handle.readFile("utf8"), symlinkTarget: target.symlinkTarget };
	} finally {
		await handle.close();
	}
}

export async function saveWorkspaceFile(
	root: string,
	path: string,
	content: string,
	expectedSymlinkTarget?: string
): Promise<void> {
	const target = await resolveEditorFile(root, path, expectedSymlinkTarget === undefined);
	if (target.symlinkTarget !== expectedSymlinkTarget) {
		throw new Error("File link target changed. Reopen the file before saving");
	}
	if (!target.symlinkTarget) await mkdir(dirname(target.full), { recursive: true });
	const checked = await resolveEditorFile(root, path, expectedSymlinkTarget === undefined);
	if (checked.full !== target.full || checked.symlinkTarget !== expectedSymlinkTarget) {
		throw new Error("File link target changed. Reopen the file before saving");
	}
	const handle = await open(
		target.full,
		constants.O_WRONLY |
			constants.O_NOFOLLOW |
			constants.O_NONBLOCK |
			(target.symlinkTarget ? 0 : constants.O_CREAT),
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
