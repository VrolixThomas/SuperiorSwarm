import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	MAX_MATCHES,
	parseGrepOutput,
	resolveGrepExit,
	searchText,
} from "../src/main/git/search-text";

const run = promisify(execFile);

function grepRecord(path: string, line: string | number, text: string): string {
	return `${path}\0${line}\0${text}\n`;
}

describe("parseGrepOutput", () => {
	test("parses path nul line nul text records", () => {
		const out = `${grepRecord("src/a.ts", 12, "const x = 1;")}${grepRecord("src/b.ts", 3, "hello")}`;
		expect(parseGrepOutput(out)).toEqual({
			matches: [
				{ path: "src/a.ts", line: 12, text: "const x = 1;" },
				{ path: "src/b.ts", line: 3, text: "hello" },
			],
			truncated: false,
		});
	});

	test("keeps colons in paths and matched text", () => {
		const out = grepRecord("a:b.ts", 1, "url: https://example.com");
		expect(parseGrepOutput(out).matches[0]).toEqual({
			path: "a:b.ts",
			line: 1,
			text: "url: https://example.com",
		});
	});

	test("skips malformed and incomplete records", () => {
		expect(parseGrepOutput("garbage\n\n").matches).toEqual([]);
		expect(parseGrepOutput(["a.ts", "1", "unterminated"].join("\0")).matches).toEqual([]);
	});

	test("skips line numbers with non-numeric suffixes", () => {
		expect(parseGrepOutput(grepRecord("a.ts", "12abc", "text")).matches).toEqual([]);
	});

	test("caps matches and sets truncated when an additional valid match exists", () => {
		const out = Array.from({ length: MAX_MATCHES + 10 }, (_, i) =>
			grepRecord("a.ts", i + 1, "x")
		).join("");
		const result = parseGrepOutput(out);
		expect(result.matches.length).toBe(MAX_MATCHES);
		expect(result.truncated).toBe(true);
	});

	test("does not set truncated for malformed lines after the match cap", () => {
		const validMatches = Array.from({ length: MAX_MATCHES }, (_, i) =>
			grepRecord("a.ts", i + 1, "x")
		).join("");
		const result = parseGrepOutput(`${validMatches}${grepRecord("a.ts", "12abc", "text")}`);
		expect(result.matches.length).toBe(MAX_MATCHES);
		expect(result.truncated).toBe(false);
	});

	test("truncates long lines to 200 chars", () => {
		const long = "y".repeat(500);
		const result = parseGrepOutput(grepRecord("a.ts", 1, long));
		expect(result.matches[0]?.text.length).toBe(200);
	});
});

describe("resolveGrepExit", () => {
	test("parses stdout for a clean exit", () => {
		expect(resolveGrepExit(0, grepRecord("a.ts", 1, "hello"))).toEqual({
			matches: [{ path: "a.ts", line: 1, text: "hello" }],
			truncated: false,
		});
	});

	test("returns null for fatal git errors with empty stdout", () => {
		expect(resolveGrepExit(128, "")).toBeNull();
	});

	test("returns null for fatal git errors with stdout that parses to no matches", () => {
		expect(resolveGrepExit(128, "fatal: not a git repository\n")).toBeNull();
	});

	test("parses captured stdout from fatal git errors and marks results truncated", () => {
		expect(resolveGrepExit(128, grepRecord("a.ts", 1, "hello"))).toEqual({
			matches: [{ path: "a.ts", line: 1, text: "hello" }],
			truncated: true,
		});
	});

	test("returns empty results for git grep no-match exit code", () => {
		expect(resolveGrepExit(1, "")).toEqual({
			matches: [],
			truncated: false,
		});
	});
});

describe("searchText (fixture repo)", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await mkdtemp(join(tmpdir(), "search-text-"));
		await run("git", ["init"], { cwd: repo });
		await writeFile(join(repo, "tracked.ts"), "const greeting = 'Hello World';\n");
		await writeFile(join(repo, "a:b.txt"), "colon path\n");
		await writeFile(join(repo, "dash.txt"), "--fixed literal\n");
		await run("git", ["add", "."], { cwd: repo });
		await writeFile(join(repo, "untracked.ts"), "// hello there\n");
	});

	afterAll(async () => {
		await rm(repo, { recursive: true, force: true });
	});

	test("finds matches in tracked and untracked files (smart case: lowercase query)", async () => {
		const result = await searchText(repo, "hello");
		const paths = result.matches.map((m) => m.path).sort();
		expect(paths).toEqual(["tracked.ts", "untracked.ts"]);
	});

	test("uppercase in query makes it case-sensitive", async () => {
		const result = await searchText(repo, "Hello World");
		expect(result.matches.length).toBe(1);
		expect(result.matches[0]?.path).toBe("tracked.ts");
		expect(result.matches[0]?.line).toBe(1);
	});

	test("finds tracked files with colons in their paths", async () => {
		const result = await searchText(repo, "colon path");
		expect(result.matches).toEqual([{ path: "a:b.txt", line: 1, text: "colon path" }]);
	});

	test("no matches returns empty, not an error", async () => {
		const result = await searchText(repo, "zzznomatch");
		expect(result).toEqual({ matches: [], truncated: false });
	});

	test("query starting with dash is treated literally", async () => {
		const result = await searchText(repo, "--fixed");
		expect(result.matches.map((match) => match.path)).toEqual(["dash.txt"]);
		expect(result.truncated).toBe(false);
	});

	test("caps repo-wide matches at MAX_MATCHES and reports truncation", async () => {
		const lines = Array.from({ length: MAX_MATCHES + 50 }, (_, i) => `needle ${i}`).join("\n");
		await writeFile(join(repo, "many-matches.txt"), `${lines}\n`);
		const result = await searchText(repo, "needle");
		expect(result.matches.length).toBe(MAX_MATCHES);
		expect(result.truncated).toBe(true);
	});
});
