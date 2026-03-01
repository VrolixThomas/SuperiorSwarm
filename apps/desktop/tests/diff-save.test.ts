import { describe, test, expect, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readWorkingTreeFile, saveWorkingTreeFile } from "../src/main/git/file-ops";

const TEST_DIR = "/tmp/bfx-file-ops-test";

afterEach(async () => {
	await rm(TEST_DIR, { recursive: true, force: true });
});

describe("readWorkingTreeFile", () => {
	test("reads a file from the working tree", async () => {
		await mkdir(join(TEST_DIR, "src"), { recursive: true });
		await writeFile(join(TEST_DIR, "src/hello.ts"), "const x = 1;");

		const content = await readWorkingTreeFile(TEST_DIR, "src/hello.ts");
		expect(content).toBe("const x = 1;");
	});

	test("returns empty string for non-existent file", async () => {
		await mkdir(TEST_DIR, { recursive: true });
		const content = await readWorkingTreeFile(TEST_DIR, "nonexistent.ts");
		expect(content).toBe("");
	});
});

describe("saveWorkingTreeFile", () => {
	test("writes content to the correct path", async () => {
		await mkdir(join(TEST_DIR, "src"), { recursive: true });

		await saveWorkingTreeFile(TEST_DIR, "src/out.ts", "export const y = 2;");

		const written = await readFile(join(TEST_DIR, "src/out.ts"), "utf-8");
		expect(written).toBe("export const y = 2;");
	});

	test("creates intermediate directories", async () => {
		await mkdir(TEST_DIR, { recursive: true });

		await saveWorkingTreeFile(TEST_DIR, "deep/nested/dir/file.ts", "hello");

		const written = await readFile(join(TEST_DIR, "deep/nested/dir/file.ts"), "utf-8");
		expect(written).toBe("hello");
	});
});
