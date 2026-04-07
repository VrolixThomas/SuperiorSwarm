import { log } from "./logger";

const MAX_DEPTH = 50;
const MAX_ISSUES = 20;

let debugMode = false;

/**
 * Enables developer debug mode. When on, `isCloneable` still walks the value
 * and writes its structured report, but returns `true` even on failure — so
 * the IPC send proceeds and V8 crashes the app, exactly like the original bug.
 * That gives you (the dev, on your own machine) a loud immediate signal plus
 * the structured report in the log. Off by default; end users never see this.
 */
export function setDebugMode(enabled: boolean): void {
	debugMode = enabled;
}

export interface InspectionResult {
	issues: string[];
	maxDepth: number;
}

interface WorkItem {
	node: unknown;
	path: string;
	depth: number;
}

/**
 * Walks an arbitrary value iteratively (no recursion — cannot blow the JS stack)
 * and reports anything that would prevent V8's structured clone from succeeding,
 * or anything that could cause V8 to recurse too deeply.
 *
 * Reports: functions, class instances, max depth exceeded, getters that throw.
 * Silently handles: cycles (structuredClone supports them), allowed builtins.
 */
export function inspect(value: unknown, label: string): InspectionResult {
	const seen = new WeakSet<object>();
	const issues: string[] = [];
	let maxDepth = 0;

	const stack: WorkItem[] = [{ node: value, path: label, depth: 0 }];

	while (stack.length > 0 && issues.length < MAX_ISSUES) {
		const item = stack.pop();
		if (item === undefined) break;
		const { node, path, depth } = item;

		if (depth > maxDepth) maxDepth = depth;

		if (depth > MAX_DEPTH) {
			issues.push(`max depth ${MAX_DEPTH} exceeded at ${path}`);
			continue;
		}

		if (node === null || node === undefined) continue;
		const t = typeof node;
		if (t === "function") {
			issues.push(`function at ${path}`);
			continue;
		}
		if (t === "symbol") {
			issues.push(`symbol at ${path}`);
			continue;
		}
		if (t !== "object") continue;

		// Cycles are silently allowed — structuredClone supports them.
		if (seen.has(node as object)) continue;
		seen.add(node as object);

		const proto = Object.getPrototypeOf(node);
		const isPlain = proto === Object.prototype || proto === null;

		if (isPlain) {
			pushObjectChildren(node as Record<string, unknown>, path, depth, stack, issues);
			continue;
		}

		if (Array.isArray(node)) {
			for (let i = node.length - 1; i >= 0; i--) {
				stack.push({ node: node[i], path: `${path}[${i}]`, depth: depth + 1 });
			}
			continue;
		}

		if (node instanceof Date || node instanceof RegExp) continue;
		if (node instanceof ArrayBuffer || ArrayBuffer.isView(node)) continue;

		if (node instanceof Map) {
			let i = 0;
			for (const [k, v] of node) {
				stack.push({ node: k, path: `${path}.@key[${i}]`, depth: depth + 1 });
				stack.push({ node: v, path: `${path}.@value[${i}]`, depth: depth + 1 });
				i++;
				if (stack.length > MAX_ISSUES * 50) break;
			}
			continue;
		}

		if (node instanceof Set) {
			let i = 0;
			for (const v of node) {
				stack.push({ node: v, path: `${path}.@item[${i}]`, depth: depth + 1 });
				i++;
				if (stack.length > MAX_ISSUES * 50) break;
			}
			continue;
		}

		// Anything else is a class instance — flag it and don't descend.
		const ctor = (proto?.constructor?.name as string | undefined) ?? "unknown";
		issues.push(`class instance ${ctor} at ${path}`);
	}

	return { issues, maxDepth };
}

function pushObjectChildren(
	obj: Record<string, unknown>,
	path: string,
	depth: number,
	stack: WorkItem[],
	issues: string[]
): void {
	let keys: string[];
	try {
		keys = Object.keys(obj);
	} catch {
		// Some exotic objects throw on Object.keys — record and bail out of this node
		issues.push(`Object.keys threw at ${path}`);
		return;
	}
	// Iterate in reverse so that stack.pop() processes keys in source order,
	// matching the array branch's reverse-push pattern.
	for (let i = keys.length - 1; i >= 0; i--) {
		const key = keys[i];
		if (key === undefined) continue;
		let value: unknown;
		try {
			value = obj[key];
		} catch {
			issues.push(`getter threw at ${path}.${key}`);
			continue;
		}
		stack.push({ node: value, path: `${path}.${key}`, depth: depth + 1 });
	}
}

/**
 * Returns true if `value` can be safely sent over Electron IPC. Returns false
 * if the walker found any issues, after writing a structured report to the log.
 *
 * Always runs the walker. Does NOT call structuredClone — V8's serializer
 * crashes uncatchably on the kinds of inputs we're trying to detect.
 */
export function isCloneable(value: unknown, label: string): boolean {
	const report = inspect(value, label);
	if (report.issues.length > 0) {
		log.error(`[ipc-safety] non-cloneable value for ${label}`, {
			maxDepth: report.maxDepth,
			issues: report.issues,
		});
		// In debug mode the dev wants the original crash for an immediate signal.
		return debugMode;
	}
	return true;
}
