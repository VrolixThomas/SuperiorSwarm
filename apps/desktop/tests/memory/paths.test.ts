import "../preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	memoryRoot,
	projectMemoryRoot,
	journalDir,
	journalFileName,
} from "../../src/main/memory/paths";

describe("memory paths", () => {
	test("memoryRoot returns <root>/memory", () => {
		const root = memoryRoot("/tmp/x");
		expect(root).toBe(join("/tmp/x", "memory"));
	});

	test("projectMemoryRoot scopes by project id", () => {
		expect(projectMemoryRoot("/tmp/x", "proj-1")).toBe(
			join("/tmp/x", "memory", "proj-1")
		);
	});

	test("journalDir scopes under project root", () => {
		expect(journalDir("/tmp/x", "proj-1")).toBe(
			join("/tmp/x", "memory", "proj-1", "journal")
		);
	});

	test("journalFileName encodes started_at and session id", () => {
		const startedAt = new Date("2026-05-16T14:32:09Z");
		expect(journalFileName(startedAt, "sess-abc")).toBe(
			"2026-05-16-143209-sess-abc.md"
		);
	});
});
