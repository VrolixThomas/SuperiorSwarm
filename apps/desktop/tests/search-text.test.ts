import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_MATCHES, parseGrepOutput, searchText } from "../src/main/git/search-text";

const run = promisify(execFile);

describe("parseGrepOutput", () => {
	test("parses path:line:text lines", () => {
		const out = "src/a.ts:12:const x = 1;\nsrc/b.ts:3:hello\n";
		expect(parseGrepOutput(out)).toEqual({
			matches: [
				{ path: "src/a.ts", line: 12, text: "const x = 1;" },
				{ path: "src/b.ts", line: 3, text: "hello" },
			],
			truncated: false,
		});
	});

	test("keeps colons in the matched text", () => {
		const out = "a.ts:1:url: https://example.com\n";
		expect(parseGrepOutput(out).matches[0]?.text).toBe("url: https://example.com");
	});

	test("skips malformed lines", () => {
		expect(parseGrepOutput("garbage\n\n").matches).toEqual([]);
	});

	test("caps matches and sets truncated", () => {
		const out = Array.from({ length: MAX_MATCHES + 10 }, (_, i) => `a.ts:${i + 1}:x`).join("\n");
		const result = parseGrepOutput(out);
		expect(result.matches.length).toBe(MAX_MATCHES);
		expect(result.truncated).toBe(true);
	});

	test("truncates long lines to 200 chars", () => {
		const long = "y".repeat(500);
		const result = parseGrepOutput(`a.ts:1:${long}\n`);
		expect(result.matches[0]?.text.length).toBe(200);
	});
});

describe("searchText (fixture repo)", () => {
	let repo: string;

	beforeAll(async () => {
		repo = await mkdtemp(join(tmpdir(), "search-text-"));
		await run("git", ["init"], { cwd: repo });
		await writeFile(join(repo, "tracked.ts"), "const greeting = 'Hello World';\n");
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

	test("no matches returns empty, not an error", async () => {
		const result = await searchText(repo, "zzznomatch");
		expect(result).toEqual({ matches: [], truncated: false });
	});

	test("query starting with dash is treated literally", async () => {
		await expect(searchText(repo, "--fixed")).resolves.toEqual({
			matches: [],
			truncated: false,
		});
	});
});
