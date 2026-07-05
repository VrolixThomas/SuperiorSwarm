function isSubsequence(needle: string, haystack: string): boolean {
	let needleIndex = 0;
	for (const char of haystack) {
		const needleChar = needle[needleIndex];
		if (needleChar === undefined) return true;
		if (char === needleChar) needleIndex++;
	}
	return needleIndex === needle.length;
}

function lengthPenalty(pathLength: number): number {
	return Math.min(pathLength, 999_999) / 1_000_000;
}

function bandScore(band: number, path: string): number {
	return band - lengthPenalty(path.length);
}

/** Higher = better. -1 = no match. Case-insensitive. */
export function fuzzyScore(query: string, path: string): number {
	const q = query.toLowerCase();
	if (q.length === 0) return 0;

	const p = path.toLowerCase();
	const slashIndex = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	const filename = slashIndex === -1 ? p : p.slice(slashIndex + 1);

	if (filename === q) return bandScore(2000, path);
	if (filename.startsWith(q)) return bandScore(1000, path);
	if (filename.includes(q)) return bandScore(800, path);
	if (isSubsequence(q, filename)) return bandScore(600, path);
	if (p.includes(q)) return bandScore(400, path);
	if (isSubsequence(q, p)) return bandScore(200, path);
	return -1;
}

export function fuzzyFilterPaths(query: string, paths: string[], limit: number): string[] {
	const scored: { path: string; score: number }[] = [];
	for (const path of paths) {
		const score = fuzzyScore(query, path);
		if (score !== -1) scored.push({ path, score });
	}

	scored.sort((a, b) => {
		const scoreDifference = b.score - a.score;
		if (scoreDifference !== 0) return scoreDifference;
		return a.path.length - b.path.length;
	});
	return scored.slice(0, limit).map((entry) => entry.path);
}
