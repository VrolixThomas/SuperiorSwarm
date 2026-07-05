import { fuzzyScore } from "./fuzzy-match";

interface FileLike {
	type: "file";
	path: string;
}

interface SymbolLike {
	type: "symbol";
	name: string;
}

/**
 * Merges file and symbol results for the All tab. Files rank by path fuzzy
 * score (exact filename = 2000 band). Exact symbol names get a 1900 band so
 * they beat everything except exact filenames; other symbols rank by name
 * fuzzy score.
 */
export function mergeAllResults<F extends FileLike, S extends SymbolLike>(
	query: string,
	files: F[],
	symbols: S[],
	limit: number
): (F | S)[] {
	const q = query.trim().toLowerCase();
	const scored: { item: F | S; score: number; order: number }[] = [];
	let order = 0;

	for (const file of files) {
		const score = fuzzyScore(q, file.path);
		if (score !== -1) scored.push({ item: file, score, order: order++ });
	}

	for (const symbol of symbols) {
		const base = fuzzyScore(q, symbol.name);
		if (base === -1) continue;
		const score = symbol.name.toLowerCase() === q ? 1900 : Math.min(base, 1800);
		scored.push({ item: symbol, score, order: order++ });
	}

	scored.sort((a, b) => b.score - a.score || a.order - b.order);
	return scored.slice(0, limit).map((entry) => entry.item);
}
