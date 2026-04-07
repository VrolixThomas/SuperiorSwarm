import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RENDERER_ROOT = join(import.meta.dir, "..", "src", "renderer");
const FORBIDDEN = /\b(invalidate|mutate|setState|refetch)\s*\(/;

function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const s = statSync(full);
		if (s.isDirectory()) out.push(...walk(full));
		else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
	}
	return out;
}

/**
 * Extract the body of a TanStack Query `select:` callback starting at the given
 * index. Walks balanced braces/parens so we never bleed into a sibling property
 * (e.g. an `onSuccess: () => mutate()` next to a pure `select`).
 *
 * Returns null if the next non-whitespace token after `select:` is not an arrow
 * function (anything else — a function reference, an identifier — is allowed
 * because the test only flags inline closures).
 */
function extractSelectBody(src: string, selectColonIdx: number): string | null {
	// Skip past `select:`
	let i = selectColonIdx + "select:".length;
	// Skip whitespace
	while (i < src.length && /\s/.test(src[i] ?? "")) i++;
	// Expect `(...) =>` (arrow function). If not, the value is something else
	// (a named function reference, an identifier) — allowed, return null.
	if (src[i] !== "(") return null;
	let depth = 0;
	let j = i;
	for (; j < src.length; j++) {
		const c = src[j];
		if (c === "(") depth++;
		else if (c === ")") {
			depth--;
			if (depth === 0) {
				j++;
				break;
			}
		}
	}
	// Skip whitespace + `=>`
	while (j < src.length && /\s/.test(src[j] ?? "")) j++;
	if (src.slice(j, j + 2) !== "=>") return null;
	j += 2;
	while (j < src.length && /\s/.test(src[j] ?? "")) j++;
	if (src[j] === "{") {
		// Block body — walk balanced braces, ignoring braces inside strings.
		let braceDepth = 0;
		let inString: string | null = null;
		const start = j;
		for (; j < src.length; j++) {
			const c = src[j];
			if (inString) {
				if (c === "\\") {
					j++;
					continue;
				}
				if (c === inString) inString = null;
				continue;
			}
			if (c === '"' || c === "'" || c === "`") {
				inString = c;
				continue;
			}
			if (c === "{") braceDepth++;
			else if (c === "}") {
				braceDepth--;
				if (braceDepth === 0) {
					return src.slice(start, j + 1);
				}
			}
		}
		return src.slice(start);
	}
	// Expression body (no braces) — return until the next top-level `,` or `)`.
	const start = j;
	let parenDepth = 0;
	for (; j < src.length; j++) {
		const c = src[j];
		if (c === "(" || c === "[" || c === "{") parenDepth++;
		else if (c === ")" || c === "]" || c === "}") {
			if (parenDepth === 0) break;
			parenDepth--;
		} else if (c === "," && parenDepth === 0) break;
	}
	return src.slice(start, j);
}

/**
 * TanStack Query v5 re-runs `select` on every render when the callback is an
 * inline arrow function (because `options.select !== _selectFn`). Side effects
 * inside `select` therefore run every render and can create infinite loops
 * (see the 2026-04-07 freeze bug, root cause in
 * docs/superpowers/plans/2026-04-07-app-freeze-fix.md).
 *
 * This test scans the renderer for `select:` callbacks and fails if any of
 * them call `invalidate`, `mutate`, `setState`, or `refetch` IN THEIR BODY
 * (not in a sibling property of the same options object).
 *
 * If this test ever false-positives, the correct response is to tighten the
 * extractor (e.g. swap to a real AST parse), NOT to silence it with a comment.
 */
describe("renderer hygiene", () => {
	test("no side effects inside TanStack Query select callbacks", () => {
		const files = walk(RENDERER_ROOT);
		const offenders: string[] = [];
		for (const file of files) {
			const src = readFileSync(file, "utf8");
			let cursor = 0;
			while (true) {
				const idx = src.indexOf("select:", cursor);
				if (idx === -1) break;
				cursor = idx + "select:".length;
				const body = extractSelectBody(src, idx);
				if (body && FORBIDDEN.test(body)) {
					offenders.push(`${file}: select callback body contains side effect`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
