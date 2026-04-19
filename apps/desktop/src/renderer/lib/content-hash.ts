/** SHA-256 hex digest of a string. Runs in the renderer via Web Crypto. */
export async function sha256Hex(content: string): Promise<string> {
	const bytes = new TextEncoder().encode(content);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const arr = Array.from(new Uint8Array(digest));
	return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** TTL-cached variant. Useful for sidebar renders that ask the same hash repeatedly. */
const hashCache = new Map<string, { hash: string; expiresAt: number }>();
const TTL_MS = 5_000;

export async function sha256HexCached(key: string, content: string): Promise<string> {
	const now = Date.now();
	const hit = hashCache.get(key);
	if (hit && hit.expiresAt > now) return hit.hash;
	const hash = await sha256Hex(content);
	hashCache.set(key, { hash, expiresAt: now + TTL_MS });
	return hash;
}

export function invalidateHashCache(key?: string): void {
	if (key === undefined) hashCache.clear();
	else hashCache.delete(key);
}
