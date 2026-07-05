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
	range?: { start?: RawPosition };
}

interface RawPosition {
	line?: unknown;
	character?: unknown;
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
	if (repoRelative === ".." || repoRelative.startsWith("../") || repoRelative.startsWith("..\\")) {
		return absolutePath;
	}
	return repoRelative;
}

function readStartPosition(
	start: RawPosition | undefined
): { line: number; column: number } | null {
	const line = start?.line;
	if (line !== undefined && (typeof line !== "number" || !Number.isFinite(line))) return null;
	const character = start?.character;
	if (character !== undefined && (typeof character !== "number" || !Number.isFinite(character))) {
		return null;
	}

	return {
		line: (line ?? 0) + 1,
		column: (character ?? 0) + 1,
	};
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
		const position = readStartPosition(symbol.location.range?.start);
		if (!position) continue;
		const key = JSON.stringify([symbol.name, path, position.line]);

		if (seen.has(key)) continue;
		seen.add(key);

		const hit: WorkspaceSymbolHit = {
			name: symbol.name,
			kind: typeof symbol.kind === "number" ? symbol.kind : 0,
			path,
			line: position.line,
			column: position.column,
		};
		if (typeof symbol.containerName === "string" && symbol.containerName.length > 0) {
			hit.container = symbol.containerName;
		}
		hits.push(hit);
	}

	return hits;
}
