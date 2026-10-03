/** Bounds are for references, independent of file extension or file size. */
export const FILE_DROP_MAX_ITEMS = 64;
export const FILE_PATH_MAX_BYTES = 16 * 1024;
export const FILE_PASTE_MAX_BYTES = 32 * 1024;
export const FILE_COPY_MAX_BYTES = 2 * 1024 ** 3;
export const FILE_WORKSPACE_MAX_BYTES = 4 * 1024 ** 3;
export const FILE_COPY_WARNING_BYTES = 100 * 1024 ** 2;
export const FILE_BATCH_TTL_MS = 10 * 60 * 1000;

// biome-ignore lint/suspicious/noControlCharactersInRegex: reject terminal control bytes, never sanitize identity.
const unsafe = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const invalidUnicode = /[\ud800-\udfff]/u;
export function hasUnsafeTerminalText(text: string): boolean {
	return unsafe.test(text) || invalidUnicode.test(text);
}
export function isSafeTerminalPath(path: string): boolean {
	return (
		path.startsWith("/") &&
		!unsafe.test(path) &&
		!invalidUnicode.test(path) &&
		new TextEncoder().encode(path).length <= FILE_PATH_MAX_BYTES
	);
}
export function displayFilePath(path: string): string {
	return Array.from(path, (char) =>
		unsafe.test(char) || invalidUnicode.test(char)
			? `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0")}`
			: char
	).join("");
}
export function formatFilePaths(paths: string[]): string {
	if (
		!paths.length ||
		paths.length > FILE_DROP_MAX_ITEMS ||
		paths.some((p) => !isSafeTerminalPath(p))
	) {
		throw new Error(
			"Choose 1–64 absolute paths without terminal controls. Unsafe names require a workspace copy."
		);
	}
	const text = ` ${paths.map((p) => `'${p.replaceAll("'", "'\\''")}'`).join(" ")} `;
	if (new TextEncoder().encode(text).length > FILE_PASTE_MAX_BYTES)
		throw new Error("Paths exceed the 32 KiB paste limit. Select fewer files.");
	return text;
}
export function isFilePaste(text: string, payload: string): boolean {
	return payload === text || payload === `\x1b[200~${text}\x1b[201~`;
}

export interface TerminalFileTarget {
	terminalId: string;
	generation: string;
	workspaceId: string;
	root: string;
}
export interface TerminalFileEntry {
	id: string;
	label: string;
	path: string | null;
	size: number;
	kind: "file" | "directory" | "unsupported";
	external: boolean;
	symlink: boolean;
	referenceAllowed: boolean;
	copyAllowed: boolean;
	error?: string;
	copyId?: string;
}
export interface TerminalFileBatch {
	id: string;
	target: TerminalFileTarget;
	entries: TerminalFileEntry[];
}
export interface TerminalOwnedCopy {
	status?: "complete" | "incomplete";
	id: string;
	workspaceId: string;
	label: string;
	path: string;
	size: number;
	createdAt: number;
}
export interface TerminalFilesAPI {
	nativePaths: (files: File[]) => Array<string | null>;
}
export type FileDelivery = "admitted" | "rejected" | "uncertain";
