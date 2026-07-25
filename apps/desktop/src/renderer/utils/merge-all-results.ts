import { fuzzyScoreLowered } from "./fuzzy-match";

interface FileLike {
	type: "file";
	path: string;
}

interface SymbolLike {
	type: "symbol";
	name: string;
}

function fuzzyScoreBand(score: number): number {
	if (score > 1999) return 2000;
	if (score > 999) return 1000;
	if (score > 799) return 800;
	if (score > 599) return 600;
	if (score > 399) return 400;
	if (score > 199) return 200;
	return score;
}

/**
 * Merges file and symbol results for the All tab. Files rank by path fuzzy
 * score (exact filename = 2000 band). Exact symbol names get a 1900 band so
 * they beat everything except exact filenames; other symbols rank by name
 * fuzzy score. Ties within a band keep input order.
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
		const base = fuzzyScoreLowered(q, file.path);
		if (base !== -1) scored.push({ item: file, score: fuzzyScoreBand(base), order: order++ });
	}

	for (const symbol of symbols) {
		const base = fuzzyScoreLowered(q, symbol.name);
		if (base === -1) continue;
		const score = symbol.name.toLowerCase() === q ? 1900 : Math.min(fuzzyScoreBand(base), 1800);
		scored.push({ item: symbol, score, order: order++ });
	}

	scored.sort((a, b) => b.score - a.score || a.order - b.order);
	return scored.slice(0, limit).map((entry) => entry.item);
}
