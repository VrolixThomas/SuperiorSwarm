import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/renderer/lib/content-hash";

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
