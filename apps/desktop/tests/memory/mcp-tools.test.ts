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

describe("mcp-standalone/server.mjs memory wiring", () => {
	for (const name of REQUIRED_TOOLS) {
		test(`registers ${name}`, () => {
			expect(SERVER).toContain(`"${name}"`);
		});
	}

	test("memory tools live inside the isWorkspaceAgentMode branch", () => {
		const branchIdx = SERVER.lastIndexOf("isWorkspaceAgentMode");
		expect(branchIdx).toBeGreaterThan(-1);
		for (const name of REQUIRED_TOOLS) {
			const toolIdx = SERVER.indexOf(`"${name}"`);
			expect(toolIdx).toBeGreaterThan(branchIdx);
		}
	});

	test("every memory tool handler calls the control plane via call()", () => {
		for (const name of REQUIRED_TOOLS) {
			const toolIdx = SERVER.indexOf(`"${name}"`);
			const slice = SERVER.slice(toolIdx, toolIdx + 2000);
			// Match both literal paths ("/memory.x") and template-literal paths (`/memory.x?…`)
			expect(slice).toMatch(/call\("(POST|GET)",\s*[`"]\/memory\./);
		}
	});

	test("server.mjs does not open SQLite from workspace-agent branch", () => {
		// All DB writes go through the control plane in the new architecture.
		const branchIdx = SERVER.lastIndexOf("isWorkspaceAgentMode");
		const wsBranch = SERVER.slice(branchIdx);
		expect(wsBranch).not.toMatch(/new Database\(/);
		expect(wsBranch).not.toMatch(/process\.env\.DB_PATH/);
		expect(wsBranch).not.toMatch(/process\.env\.MEMORY_ROOT/);
	});

	test("memory tools omit project_id from their inputs (server derives via X-Workspace-Id)", () => {
		for (const name of REQUIRED_TOOLS) {
			const toolIdx = SERVER.indexOf(`"${name}"`);
			const slice = SERVER.slice(toolIdx, toolIdx + 2000);
			expect(slice).not.toMatch(/project_id:/);
			expect(slice).not.toMatch(/projectId:/);
		}
	});
});
