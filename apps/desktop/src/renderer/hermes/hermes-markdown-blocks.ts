const HERMES_MARKDOWN_BLOCK_TARGET_CHARS = 4_096;
const EXACT_CACHE_MAX_ENTRIES = 64;
const EXACT_CACHE_MAX_CHARS = 4 * 1_024 * 1_024;
const APPEND_CACHE_MAX = 4;
const APPEND_CACHE_MIN_CHARS = 2_048;

const exactCache = new Map<string, string[]>();
let exactCacheCharacters = 0;
const appendCache: Array<{ text: string; blocks: string[] }> = [];

function splitHermesMarkdownFully(markdown: string): string[] {
	if (!markdown) return [];
	const blocks: string[] = [];
	let start = 0;
	let cursor = 0;
	let fence: "```" | "~~~" | null = null;
	while (cursor < markdown.length) {
		const newline = markdown.indexOf("\n", cursor);
		const end = newline === -1 ? markdown.length : newline + 1;
		const line = markdown.slice(cursor, newline === -1 ? markdown.length : newline).trimStart();
		const marker = line.startsWith("```") ? "```" : line.startsWith("~~~") ? "~~~" : null;
		if (marker && (fence === null || fence === marker)) fence = fence === marker ? null : marker;
		if (fence === null && line.trim() === "" && end - start >= HERMES_MARKDOWN_BLOCK_TARGET_CHARS) {
			blocks.push(markdown.slice(start, end));
			start = end;
		}
		cursor = end;
	}
	if (start < markdown.length) blocks.push(markdown.slice(start));
	return blocks.length > 0 ? blocks : [markdown];
}

function splitHermesMarkdownIncrementally(markdown: string): string[] | null {
	const prior = appendCache.find(
		(candidate) => markdown.length > candidate.text.length && markdown.startsWith(candidate.text)
	);
	if (!prior || prior.blocks.length < 3) return null;
	const stable = prior.blocks.slice(0, -2);
	const stableLength = stable.reduce((total, block) => total + block.length, 0);
	if (stableLength <= 0 || !markdown.startsWith(prior.text.slice(0, stableLength))) return null;
	return [...stable, ...splitHermesMarkdownFully(markdown.slice(stableLength))];
}

function rememberAppend(markdown: string, blocks: string[]): void {
	if (markdown.length < APPEND_CACHE_MIN_CHARS) return;
	const priorIndex = appendCache.findIndex((candidate) => markdown.startsWith(candidate.text));
	if (priorIndex >= 0) appendCache.splice(priorIndex, 1);
	appendCache.push({ text: markdown, blocks });
	if (appendCache.length > APPEND_CACHE_MAX) appendCache.shift();
}

function rememberExact(markdown: string, blocks: string[]): void {
	exactCache.set(markdown, blocks);
	exactCacheCharacters += markdown.length;
	while (
		exactCache.size > EXACT_CACHE_MAX_ENTRIES ||
		exactCacheCharacters > EXACT_CACHE_MAX_CHARS
	) {
		const oldest = exactCache.keys().next().value;
		if (typeof oldest !== "string") break;
		exactCache.delete(oldest);
		exactCacheCharacters -= oldest.length;
	}
}

/** Stable coarse blocks for a growing reply; only the final two blocks are re-split. */
export function splitHermesStreamingMarkdown(markdown: string): string[] {
	const hit = exactCache.get(markdown);
	if (hit) {
		exactCache.delete(markdown);
		exactCache.set(markdown, hit);
		return hit;
	}
	const blocks = splitHermesMarkdownIncrementally(markdown) ?? splitHermesMarkdownFully(markdown);
	if (blocks.join("") !== markdown) return [markdown];
	rememberAppend(markdown, blocks);
	rememberExact(markdown, blocks);
	return blocks;
}
