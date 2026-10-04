import { FILE_DROP_MAX_ITEMS, FILE_PATH_MAX_BYTES } from "../shared/terminal-files";

/** getPathForFile is injected solely by preload, never by the renderer. */
export function resolveNativeFiles(
	files: File[],
	getPathForFile: (file: File) => string
): Array<string | null> {
	if (!Array.isArray(files) || files.length > FILE_DROP_MAX_ITEMS)
		throw new Error("Drop at most 64 files.");
	return files.map((file) => {
		if (
			!file ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0 ||
			!Number.isFinite(file.lastModified)
		) {
			throw new Error("Invalid file metadata.");
		}
		try {
			const path = getPathForFile(file);
			return path && new TextEncoder().encode(path).length <= FILE_PATH_MAX_BYTES ? path : null;
		} catch {
			return null;
		}
	});
}
