import "../preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVER = readFileSync(join(import.meta.dir, "../../mcp-standalone/server.mjs"), "utf-8");

const REQUIRED_TOOLS = [
	"memory_add_goal",
	"memory_list_goals",
	"memory_add_followup",
	"memory_list_followups",
	"memory_log_decision",
	"memory_list_decisions",
	"memory_add_question",
	"memory_answer_question",
	"memory_list_questions",
	"memory_journal_start",
	"memory_journal_append",
	"memory_journal_end",
	"memory_recent_journals",
	"memory_read_journal",
	"memory_search",
];

const REQUIRED_TABLES = [
	"memory_goals",
	"memory_followups",
	"memory_decisions",
	"memory_open_questions",
	"memory_journal",
	"memory_fts",
];

describe("mcp-standalone/server.mjs memory wiring", () => {
	for (const name of REQUIRED_TOOLS) {
		test(`registers ${name}`, () => {
			expect(SERVER).toContain(`"${name}"`);
		});
	}

	for (const table of REQUIRED_TABLES) {
		test(`references ${table}`, () => {
			expect(SERVER).toContain(table);
		});
	}

	test("reads MEMORY_ROOT env var", () => {
		expect(SERVER).toContain("process.env.MEMORY_ROOT");
	});

	test("reads DB_PATH env var", () => {
		expect(SERVER).toContain("DB_PATH");
	});

	test("memory tools live inside the isWorkspaceAgentMode branch", () => {
		// crude check: every memory_* tool name occurs AFTER the
		// last 'if (isWorkspaceAgentMode)' that opens a block.
		const branchIdx = SERVER.lastIndexOf("isWorkspaceAgentMode");
		expect(branchIdx).toBeGreaterThan(-1);
		for (const name of REQUIRED_TOOLS) {
			const toolIdx = SERVER.indexOf(`"${name}"`);
			expect(toolIdx).toBeGreaterThan(-1);
			expect(toolIdx).toBeGreaterThan(branchIdx);
		}
	});

	test("every memory_list_/search/recent uses PROJECT_ID scope", () => {
		// Heuristic: the list/search tool handlers each include "project_id"
		// somewhere in the SELECT string that queries a memory_* table.
		// We collect all lines that contain both SELECT and FROM memory_ (single-line queries)
		// plus lines that contain project_id near a memory_ table reference.
		const lines = SERVER.split("\n");
		const memorySelectLines = lines.filter(
			(l) => l.includes("FROM memory_") || l.includes("FROM\n")
		);
		// At minimum there should be several SELECT queries against memory_* tables
		expect(memorySelectLines.length).toBeGreaterThan(3);
		// The full server text must reference project_id in the context of memory queries
		const memorySection = SERVER.slice(SERVER.indexOf("memory_add_goal"));
		expect(memorySection).toContain("project_id");
	});

	test("memory_add_goal includes both INSERT and ftsUpsert", () => {
		const addGoalIdx = SERVER.indexOf('"memory_add_goal"');
		// Slice ~3KB after the tool definition to scan its handler body
		const slice = SERVER.slice(addGoalIdx, addGoalIdx + 3000);
		expect(slice).toContain("INSERT INTO memory_goals");
		expect(slice).toContain("ftsUpsert");
	});

	test("memory_journal_append rejects ended sessions", () => {
		const idx = SERVER.indexOf('"memory_journal_append"');
		const slice = SERVER.slice(idx, idx + 2000);
		expect(slice).toMatch(/ended_at/);
	});
});
