import { describe, expect, test } from "bun:test";
import { createGitCache } from "../src/main/git/git-cache";

describe("git-cache", () => {
	test("returns cached value when version unchanged", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = () => {
			calls++;
			return Promise.resolve({ a: 1 });
		};
		await cache.get("k", 1, compute);
		await cache.get("k", 1, compute);
		expect(calls).toBe(1);
	});

	test("recomputes when version changes", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = () => {
			calls++;
			return Promise.resolve({ a: calls });
		};
		await cache.get("k", 1, compute);
		await cache.get("k", 2, compute);
		expect(calls).toBe(2);
	});

	test("scopes by key", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = () => {
			calls++;
			return Promise.resolve({ a: 0 });
		};
		await cache.get("a", 1, compute);
		await cache.get("b", 1, compute);
		expect(calls).toBe(2);
	});

	test("dedupes concurrent calls for same (key,version)", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = async () => {
			calls++;
			await new Promise((r) => setTimeout(r, 50));
			return { a: 1 };
		};
		await Promise.all([
			cache.get("k", 1, compute),
			cache.get("k", 1, compute),
			cache.get("k", 1, compute),
		]);
		expect(calls).toBe(1);
	});
});
