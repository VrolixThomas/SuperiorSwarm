import { describe, expect, test } from "bun:test";
import { LruMap } from "../src/main/lsp/lru-map";

describe("LruMap", () => {
	test("evicts oldest entry when size exceeds max", () => {
		const lru = new LruMap<string, number>(3);
		lru.set("a", 1);
		lru.set("b", 2);
		lru.set("c", 3);
		lru.set("d", 4);
		expect(lru.has("a")).toBe(false);
		expect(lru.has("d")).toBe(true);
		expect(lru.size).toBe(3);
	});

	test("get() moves entry to most-recently-used", () => {
		const lru = new LruMap<string, number>(3);
		lru.set("a", 1);
		lru.set("b", 2);
		lru.set("c", 3);
		lru.get("a");
		lru.set("d", 4);
		expect(lru.has("b")).toBe(false);
		expect(lru.has("a")).toBe(true);
	});

	test("set() on existing key updates value without changing size", () => {
		const lru = new LruMap<string, number>(2);
		lru.set("a", 1);
		lru.set("a", 2);
		expect(lru.get("a")).toBe(2);
		expect(lru.size).toBe(1);
	});

	test("delete() removes entry", () => {
		const lru = new LruMap<string, number>(2);
		lru.set("a", 1);
		lru.delete("a");
		expect(lru.has("a")).toBe(false);
	});

	test("clear() empties the map", () => {
		const lru = new LruMap<string, number>(2);
		lru.set("a", 1);
		lru.set("b", 2);
		lru.clear();
		expect(lru.size).toBe(0);
	});

	test("keys() iterates in LRU→MRU order", () => {
		const lru = new LruMap<string, number>(3);
		lru.set("a", 1);
		lru.set("b", 2);
		lru.set("c", 3);
		lru.get("a");
		expect([...lru.keys()]).toEqual(["b", "c", "a"]);
	});
});
