function isSubsequence(needle: string, haystack: string): boolean {
	let needleIndex = 0;
	for (const char of haystack) {
		const needleChar = needle[needleIndex];
		if (needleChar === undefined) return true;
		if (char === needleChar) needleIndex++;
	}
	return needleIndex === needle.length;
}

/** Higher = better. -1 = no match. Case-insensitive. */
export function fuzzyScore(query: string, path: string): number {
	const q = query.toLowerCase();
	if (q.length === 0) return 0;

	const p = path.toLowerCase();
	const slashIndex = p.lastIndexOf("/");
	const filename = slashIndex === -1 ? p : p.slice(slashIndex + 1);
	const tiebreak = -path.length;

	if (filename === q) return 2000 + tiebreak;
	if (filename.startsWith(q)) return 1000 + tiebreak;
	if (filename.includes(q)) return 800 + tiebreak;
	if (isSubsequence(q, filename)) return 600 + tiebreak;
	if (p.includes(q)) return 400 + tiebreak;
	if (isSubsequence(q, p)) return 200 + tiebreak;
	return -1;
}

export function fuzzyFilterPaths(query: string, paths: string[], limit: number): string[] {
	const scored: { path: string; score: number }[] = [];
	for (const path of paths) {
		const score = fuzzyScore(query, path);
		if (score !== -1) scored.push({ path, score });
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((entry) => entry.path);
}
