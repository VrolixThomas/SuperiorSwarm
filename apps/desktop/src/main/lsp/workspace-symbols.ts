import { relative } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_SYMBOLS = 100;

export interface WorkspaceSymbolHit {
	name: string;
	kind: number;
	path: string;
	line: number;
	column: number;
	container?: string;
}

interface RawLocation {
	uri?: string;
	range?: { start?: { line?: number; character?: number } };
}

interface RawSymbol {
	name?: string;
	kind?: number;
	containerName?: string;
	location?: RawLocation;
}

function uriToPath(uri: string): string {
	try {
		return fileURLToPath(uri);
	} catch {
		let path = uri.replace(/^file:\/\//, "");
		try {
			path = decodeURIComponent(path);
		} catch {
			// Keep the raw path if the server returns malformed URI escapes.
		}
		return path;
	}
}

function pathForRepo(uri: string, repoPath: string): string {
	const absolutePath = uriToPath(uri);
	const repoRelative = relative(repoPath, absolutePath);
	if (repoRelative === "") return "";
	if (!repoRelative.startsWith("..") && !repoRelative.startsWith("/")) return repoRelative;
	return absolutePath;
}

export function normalizeWorkspaceSymbols(raw: unknown[], repoPath: string): WorkspaceSymbolHit[] {
	const hits: WorkspaceSymbolHit[] = [];
	const seen = new Set<string>();

	for (const entry of raw) {
		if (hits.length >= MAX_SYMBOLS) break;
		if (typeof entry !== "object" || entry === null) continue;

		const symbol = entry as RawSymbol;
		if (typeof symbol.name !== "string" || typeof symbol.location?.uri !== "string") continue;

		const path = pathForRepo(symbol.location.uri, repoPath);
		const start = symbol.location.range?.start;
		const line = (start?.line ?? 0) + 1;
		const column = (start?.character ?? 0) + 1;
		const key = `${symbol.name}:${path}:${line}`;

		if (seen.has(key)) continue;
		seen.add(key);

		const hit: WorkspaceSymbolHit = {
			name: symbol.name,
			kind: typeof symbol.kind === "number" ? symbol.kind : 0,
			path,
			line,
			column,
		};
		if (typeof symbol.containerName === "string" && symbol.containerName.length > 0) {
			hit.container = symbol.containerName;
		}
		hits.push(hit);
	}

	return hits;
}
