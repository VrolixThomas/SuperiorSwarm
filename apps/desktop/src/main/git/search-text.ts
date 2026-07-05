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

	for (const line of stdout.split("\n")) {
		if (line.length === 0) continue;
		if (matches.length >= MAX_MATCHES) {
			truncated = true;
			break;
		}

		const first = line.indexOf(":");
		if (first === -1) continue;

		const second = line.indexOf(":", first + 1);
		if (second === -1) continue;

		const lineNumber = Number.parseInt(line.slice(first + 1, second), 10);
		if (Number.isNaN(lineNumber)) continue;

		matches.push({
			path: line.slice(0, first),
			line: lineNumber,
			text: line.slice(second + 1, second + 1 + MAX_LINE_LENGTH),
		});
	}

	return { matches, truncated };
}

/**
 * Literal text search via `git grep`, including tracked and untracked
 * non-ignored files while skipping binary content.
 */
export async function searchText(repoPath: string, query: string): Promise<TextSearchResult> {
	const args = ["grep", "-n", "-I", "--untracked", "--fixed-strings"];
	if (query === query.toLowerCase()) args.push("-i");
	args.push("-e", query);

	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd: repoPath,
			maxBuffer: 16 * 1024 * 1024,
		});
		return parseGrepOutput(stdout);
	} catch (err) {
		const error = err as { code?: number | string };
		if (error.code === 1) return { matches: [], truncated: false };
		throw err;
	}
}
