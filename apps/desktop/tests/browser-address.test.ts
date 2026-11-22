import { describe, expect, test } from "bun:test";
import { browserAgentRequestSchema } from "../src/shared/browser";
import { resolveBrowserAddress } from "../src/shared/browser-address";

describe("browser address bar", () => {
	test.each([
		"youtube",
		" how to use node.js ",
		"site:youtube.com electron",
		"site:youtube.com",
		"café & 日本語 #tutorial",
		"what is 50% + 20%?",
	])("searches %s as one encoded query", (input) => {
		const url = new URL(resolveBrowserAddress(input) as string);
		expect(url.origin + url.pathname).toBe("https://www.google.com/search");
		expect([...url.searchParams]).toEqual([["q", input.trim()]]);
		expect(url.hash).toBe("");
	});
	test.each([
		["youtube.com", "https://youtube.com/"],
		[" www.youtube.com/watch?v=test#chapter ", "https://www.youtube.com/watch?v=test#chapter"],
		["example.com:8443/path", "https://example.com:8443/path"],
		["intranet:8443/path", "https://intranet:8443/path"],
		["https://intranet", "https://intranet/"],
		["https://example.com/a b", "https://example.com/a%20b"],
		["münchen.de", "https://xn--mnchen-3ya.de/"],
		["localhost", "http://localhost/"],
		["localhost:5173/test?q=one#two", "http://localhost:5173/test?q=one#two"],
		["127.0.0.1:3000", "http://127.0.0.1:3000/"],
		["[::1]:3000", "http://[::1]:3000/"],
	])("navigates directly for %s", (input, expected) => {
		expect(resolveBrowserAddress(input)).toBe(expected);
	});
	test.each([
		"javascript:alert(1)",
		"javascript: alert(1)",
		"data:text/html,hello world",
		"file:///tmp/private",
		"custom://private",
		"https://user:secret@example.com",
		"user:secret@example.com/path with spaces",
		"user:secret@internal",
		"http://example.com",
		"https://",
		"https://example.com:99999",
		"example.com:99999",
		"java\nscript:alert(1)",
	])("rejects %s without forwarding it to search", (input) => {
		expect(() => resolveBrowserAddress(input)).toThrow();
	});
	test("ignores blank input and rejects oversized searches", () => {
		expect(resolveBrowserAddress("  ")).toBeNull();
		expect(() => resolveBrowserAddress("a".repeat(8192))).toThrow("too long");
	});
	test("search interpretation does not widen agent navigation", () => {
		expect(browserAgentRequestSchema.safeParse({ operation: "open", url: "youtube" }).success).toBe(
			false
		);
	});
});
