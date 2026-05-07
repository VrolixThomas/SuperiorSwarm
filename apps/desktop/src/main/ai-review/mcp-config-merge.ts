import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	rmdirSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type KeyPath = readonly string[];

export interface MergeState {
	fileExistedBefore: boolean;
	dirExistedBefore: boolean;
}

export class McpConfigParseError extends Error {
	constructor(filePath: string, cause: unknown) {
		const msg = cause instanceof Error ? cause.message : String(cause);
		super(`Failed to parse MCP config at ${filePath}: ${msg}`);
		this.name = "McpConfigParseError";
	}
}

type Indent = string;
const DEFAULT_INDENT: Indent = "  ";

function detectIndent(text: string): Indent {
	const m = text.match(/\n([\t ]+)\S/);
	return m?.[1] ?? DEFAULT_INDENT;
}

function readJson(filePath: string): { obj: Record<string, unknown>; indent: Indent } {
	if (!existsSync(filePath)) return { obj: {}, indent: DEFAULT_INDENT };
	const text = readFileSync(filePath, "utf-8");
	if (text.trim() === "") return { obj: {}, indent: DEFAULT_INDENT };
	try {
		const obj = JSON.parse(text);
		if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
			throw new Error("root is not an object");
		}
		return { obj: obj as Record<string, unknown>, indent: detectIndent(text) };
	} catch (cause) {
		throw new McpConfigParseError(filePath, cause);
	}
}

function writeJsonAtomic(filePath: string, obj: unknown, indent: Indent): void {
	const text = `${JSON.stringify(obj, null, indent)}\n`;
	const tmp = `${filePath}.tmp`;
	writeFileSync(tmp, text, "utf-8");
	renameSync(tmp, filePath);
}

function setDeep(root: Record<string, unknown>, keyPath: KeyPath, value: unknown): void {
	let cur: Record<string, unknown> = root;
	for (let i = 0; i < keyPath.length - 1; i++) {
		const k = keyPath[i]!;
		const next = cur[k];
		if (next == null || typeof next !== "object" || Array.isArray(next)) {
			cur[k] = {};
		}
		cur = cur[k] as Record<string, unknown>;
	}
	cur[keyPath[keyPath.length - 1]!] = value;
}

function deleteDeepAndCollapse(root: Record<string, unknown>, keyPath: KeyPath): void {
	const stack: Record<string, unknown>[] = [root];
	let cur: Record<string, unknown> = root;
	for (let i = 0; i < keyPath.length - 1; i++) {
		const k = keyPath[i]!;
		const next = cur[k];
		if (next == null || typeof next !== "object" || Array.isArray(next)) return;
		cur = next as Record<string, unknown>;
		stack.push(cur);
	}
	delete cur[keyPath[keyPath.length - 1]!];
	for (let i = stack.length - 1; i > 0; i--) {
		const node = stack[i]!;
		const parent = stack[i - 1]!;
		const parentKey = keyPath[i - 1]!;
		if (Object.keys(node).length === 0) {
			delete parent[parentKey];
		} else {
			break;
		}
	}
}

function isEmptyObject(o: unknown): boolean {
	return !!o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length === 0;
}

export function mergeKey(filePath: string, keyPath: KeyPath, value: unknown): MergeState {
	const fileExistedBefore = existsSync(filePath);
	const dir = dirname(filePath);
	const dirExistedBefore = existsSync(dir);

	if (!dirExistedBefore) mkdirSync(dir, { recursive: true });

	const { obj, indent } = readJson(filePath);
	setDeep(obj, keyPath, value);
	writeJsonAtomic(filePath, obj, indent);

	return { fileExistedBefore, dirExistedBefore };
}

export function removeKey(filePath: string, keyPath: KeyPath, state: MergeState): void {
	if (!existsSync(filePath)) return;

	let parsed: { obj: Record<string, unknown>; indent: Indent };
	try {
		parsed = readJson(filePath);
	} catch {
		return;
	}
	const { obj, indent } = parsed;
	deleteDeepAndCollapse(obj, keyPath);

	if (isEmptyObject(obj) && !state.fileExistedBefore) {
		rmSync(filePath, { force: true });
		const dir = dirname(filePath);
		if (!state.dirExistedBefore) {
			try {
				rmdirSync(dir);
			} catch {}
		}
		return;
	}

	writeJsonAtomic(filePath, obj, indent);
}
