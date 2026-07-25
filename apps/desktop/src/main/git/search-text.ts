import { spawn } from "node:child_process";

export const MAX_MATCHES = 200;
const MAX_LINE_LENGTH = 200;
const MAX_OUTPUT_LENGTH = 16 * 1024 * 1024;

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

/** Maps a completed `git grep` exit to a result. null = fatal error with no usable output. */
export function resolveGrepExit(code: number | null, stdout: string): TextSearchResult | null {
	if (code === 0) return parseGrepOutput(stdout);
	if (code === 1) return { matches: [], truncated: false };

	const result = parseGrepOutput(stdout);
	if (result.matches.length === 0) return null;
	return { ...result, truncated: true };
}

const runningSearches = new Map<string, () => void>();

/**
 * Literal text search via `git grep`, including tracked and untracked
 * non-ignored files while skipping binary content. Output is streamed so the
 * grep is killed as soon as the match cap (or output budget) is reached, and
 * a new search for the same repo kills the superseded one.
 */
export async function searchText(repoPath: string, query: string): Promise<TextSearchResult> {
	const args = ["grep", "-z", "-n", "-I", "--untracked", "--fixed-strings"];
	if (query === query.toLowerCase()) args.push("-i");
	args.push("-e", query);

	runningSearches.get(repoPath)?.();

	return new Promise((resolve, reject) => {
		const child = spawn("git", args, { cwd: repoPath });
		let stdout = "";
		let stderr = "";
		let records = 0;
		let killedEarly = false;

		const killEarly = () => {
			if (killedEarly) return;
			killedEarly = true;
			child.kill();
		};
		runningSearches.set(repoPath, killEarly);
		const cleanup = () => {
			if (runningSearches.get(repoPath) === killEarly) runningSearches.delete(repoPath);
		};

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (killedEarly) return;
			stdout += chunk;
			for (let i = chunk.indexOf("\n"); i !== -1; i = chunk.indexOf("\n", i + 1)) records++;
			// One match record per newline; one record past the cap is enough to
			// know the result is truncated, so stop the repo scan there.
			if (records > MAX_MATCHES || stdout.length >= MAX_OUTPUT_LENGTH) killEarly();
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (err) => {
			cleanup();
			reject(err);
		});
		child.on("close", (code) => {
			cleanup();
			if (killedEarly) {
				resolve(parseGrepOutput(stdout));
				return;
			}
			const result = resolveGrepExit(code, stdout);
			if (result) resolve(result);
			else reject(new Error(`git grep failed (exit ${code}): ${stderr.trim()}`));
		});
	});
}
