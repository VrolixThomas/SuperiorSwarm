import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MAX_MATCHES = 200;
const MAX_LINE_LENGTH = 200;

export interface TextMatch {
	path: string;
	line: number;
	text: string;
}

export interface TextSearchResult {
	matches: TextMatch[];
	truncated: boolean;
}

export function parseGrepOutput(stdout: string): TextSearchResult {
	const matches: TextMatch[] = [];
	let truncated = false;
	let cursor = 0;

	while (cursor < stdout.length) {
		const pathEnd = stdout.indexOf("\0", cursor);
		if (pathEnd === -1) break;

		const lineEnd = stdout.indexOf("\0", pathEnd + 1);
		if (lineEnd === -1) break;

		const textEnd = stdout.indexOf("\n", lineEnd + 1);
		if (textEnd === -1) break;

		const path = stdout.slice(cursor, pathEnd);
		const lineNumberText = stdout.slice(pathEnd + 1, lineEnd);
		const text = stdout.slice(lineEnd + 1, textEnd);
		cursor = textEnd + 1;

		if (!/^\d+$/.test(lineNumberText)) continue;

		if (matches.length >= MAX_MATCHES) {
			truncated = true;
			break;
		}

		matches.push({
			path,
			line: Number.parseInt(lineNumberText, 10),
			text: text.slice(0, MAX_LINE_LENGTH),
		});
	}

	return { matches, truncated };
}

export function parseGrepExecFileError(err: unknown): TextSearchResult | null {
	const error = err as { code?: number | string; stdout?: unknown };
	if (error.code === 1) return { matches: [], truncated: false };

	if (typeof error.stdout === "string") {
		const result = parseGrepOutput(error.stdout);
		if (result.matches.length === 0) return null;
		return { ...result, truncated: true };
	}

	return null;
}

/**
 * Literal text search via `git grep`, including tracked and untracked
 * non-ignored files while skipping binary content.
 */
export async function searchText(repoPath: string, query: string): Promise<TextSearchResult> {
	const args = ["grep", "-z", "-n", "-I", "--untracked", "--fixed-strings"];
	if (query === query.toLowerCase()) args.push("-i");
	args.push("-e", query);

	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd: repoPath,
			maxBuffer: 16 * 1024 * 1024,
		});
		return parseGrepOutput(stdout);
	} catch (err) {
		const result = parseGrepExecFileError(err);
		if (result) return result;
		throw err;
	}
}
