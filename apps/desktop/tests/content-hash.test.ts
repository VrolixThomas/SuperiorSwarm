import { beforeEach, describe, expect, test } from "bun:test";
import { invalidateHashCache, sha256Hex, sha256HexCached } from "../src/renderer/lib/content-hash";

describe("sha256Hex", () => {
	test("hashes ascii content", async () => {
		const h = await sha256Hex("hello");
		expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	});

	test("is deterministic", async () => {
		expect(await sha256Hex("x")).toBe(await sha256Hex("x"));
	});

	test("differs for different content", async () => {
		expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
	});
});

describe("sha256HexCached", () => {
	beforeEach(() => invalidateHashCache());

	test("returns identical hash to sha256Hex for the same content", async () => {
		const raw = await sha256Hex("hello");
		const cached = await sha256HexCached("k1", "hello");
		expect(cached).toBe(raw);
	});

	test("cache hit returns the stored hash even if content changes within TTL", async () => {
		const first = await sha256HexCached("k1", "hello");
		// Same key, different content — within TTL we expect the cached value back.
		const second = await sha256HexCached("k1", "world");
		expect(second).toBe(first);
	});

	test("invalidateHashCache(key) forces recompute for that key", async () => {
		await sha256HexCached("k1", "hello");
		invalidateHashCache("k1");
		const recomputed = await sha256HexCached("k1", "world");
		expect(recomputed).toBe(await sha256Hex("world"));
	});

	test("invalidateHashCache() (no arg) clears all entries", async () => {
		await sha256HexCached("k1", "hello");
		await sha256HexCached("k2", "hello");
		invalidateHashCache();
		const r1 = await sha256HexCached("k1", "world");
		const r2 = await sha256HexCached("k2", "world");
		expect(r1).toBe(await sha256Hex("world"));
		expect(r2).toBe(await sha256Hex("world"));
	});
});
