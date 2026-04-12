/** Combine two ETags into one opaque cache key. */
export function joinCacheKey(issueEtag: string, reviewEtag: string): string {
	return `${issueEtag}|${reviewEtag}`;
}

/** Split a combined cache key back into [issueEtag, reviewEtag]. */
export function splitCacheKey(cacheKey: string): [string, string] {
	const idx = cacheKey.indexOf("|");
	if (idx === -1) return [cacheKey, cacheKey];
	return [cacheKey.slice(0, idx), cacheKey.slice(idx + 1)];
}
