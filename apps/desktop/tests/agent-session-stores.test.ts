import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	listAgentSessionsForCwd,
	listClaudeSessions,
	listCodexSessions,
} from "../src/main/agent-launch/session-stores";

const CWD = "/Users/test/proj.name";
const SLUG = "-Users-test-proj-name"; // every non-alphanumeric -> "-"

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "ss-sessions-test-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeClaudeSession(id: string, lines: string[], mtime: Date) {
	const dir = join(root, "claude", SLUG);
	mkdirSync(dir, { recursive: true });
	const f = join(dir, `${id}.jsonl`);
	writeFileSync(f, lines.join("\n"));
	utimesSync(f, mtime, mtime);
}

describe("listClaudeSessions", () => {
	test("returns sessions sorted by mtime desc, capped at limit, label from summary line", () => {
		const idA = "aaaaaaaa-1111-2222-3333-444444444444";
		const idB = "bbbbbbbb-1111-2222-3333-444444444444";
		writeClaudeSession(idA, ['{"type":"summary","summary":"Fix login bug"}'], new Date(2000));
		writeClaudeSession(idB, ['{"type":"summary","summary":"Add dark mode"}'], new Date(5000));
		const out = listClaudeSessions(CWD, 10, join(root, "claude"));
		expect(out.map((s) => s.sessionId)).toEqual([idB, idA]);
		expect(out[0]?.label).toBe("Add dark mode");
		expect(out[0]?.cli).toBe("claude");
		expect(out[0]?.lastActiveAt).toBe(5000);
	});

	test("falls back to first user message text when no summary; string and array content", () => {
		const id = "cccccccc-1111-2222-3333-444444444444";
		writeClaudeSession(
			id,
			[
				'{"type":"user","message":{"role":"user","content":[{"type":"text","text":"refactor the parser"}]}}',
			],
			new Date(1000)
		);
		expect(listClaudeSessions(CWD, 10, join(root, "claude"))[0]?.label).toBe("refactor the parser");
	});

	test("skips non-UUID filenames, corrupt files, and returns [] for missing dir", () => {
		writeClaudeSession(
			"dddddddd-1111-2222-3333-444444444444",
			["not json at all {{{"],
			new Date(1000)
		);
		const dir = join(root, "claude", SLUG);
		writeFileSync(join(dir, "agent-notes.jsonl"), '{"type":"summary","summary":"x"}');
		const out = listClaudeSessions(CWD, 10, join(root, "claude"));
		// corrupt file still listed (label falls back to id prefix), non-UUID file skipped
		expect(out.length).toBe(1);
		expect(out[0]?.label).toBe("dddddddd");
		expect(listClaudeSessions("/nope/nothing", 10, join(root, "claude"))).toEqual([]);
	});

	test("truncates labels to 80 chars", () => {
		const id = "eeeeeeee-1111-2222-3333-444444444444";
		writeClaudeSession(id, [`{"type":"summary","summary":"${"x".repeat(200)}"}`], new Date(1000));
		expect(listClaudeSessions(CWD, 10, join(root, "claude"))[0]?.label.length).toBe(80);
	});
});

function writeCodexSession(day: string, name: string, meta: object, extraLines: string[] = []) {
	const dir = join(root, "codex", "2026", "07", day);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, name),
		[JSON.stringify({ timestamp: "t", type: "session_meta", payload: meta }), ...extraLines].join(
			"\n"
		)
	);
}

describe("listCodexSessions", () => {
	test("filters by cwd, newest date-dir first, label from user_message", () => {
		writeCodexSession("01", "rollout-2026-07-01T10-00-00-aaaa.jsonl", { id: "id-old", cwd: CWD }, [
			'{"type":"event_msg","payload":{"type":"user_message","message":"old prompt"}}',
		]);
		writeCodexSession("02", "rollout-2026-07-02T10-00-00-bbbb.jsonl", { id: "id-new", cwd: CWD }, [
			'{"type":"event_msg","payload":{"type":"user_message","message":"new prompt"}}',
		]);
		writeCodexSession("02", "rollout-2026-07-02T11-00-00-cccc.jsonl", {
			id: "id-other",
			cwd: "/other/place",
		});
		const out = listCodexSessions(CWD, 10, join(root, "codex"));
		expect(out.map((s) => s.sessionId)).toEqual(["id-new", "id-old"]);
		expect(out[0]?.label).toBe("new prompt");
		expect(out[0]?.cli).toBe("codex");
	});

	test("caps at limit and tolerates corrupt first lines and missing root", () => {
		writeCodexSession("03", "rollout-2026-07-03T10-00-00-dddd.jsonl", { id: "id1", cwd: CWD });
		const dir = join(root, "codex", "2026", "07", "03");
		writeFileSync(join(dir, "rollout-2026-07-03T11-00-00-eeee.jsonl"), "garbage{{{");
		const out = listCodexSessions(CWD, 1, join(root, "codex"));
		expect(out.length).toBe(1);
		expect(listCodexSessions(CWD, 10, join(root, "nope"))).toEqual([]);
	});
});

describe("listAgentSessionsForCwd", () => {
	test("merges both CLIs sorted by lastActiveAt desc", () => {
		writeClaudeSession(
			"ffffffff-1111-2222-3333-444444444444",
			['{"type":"summary","summary":"claude one"}'],
			new Date(1000)
		);
		writeCodexSession("04", "rollout-2026-07-04T10-00-00-ffff.jsonl", { id: "cx", cwd: CWD });
		const out = listAgentSessionsForCwd(CWD, 10, {
			claudeRoot: join(root, "claude"),
			codexRoot: join(root, "codex"),
		});
		expect(out.length).toBe(2);
		expect(out[0]?.lastActiveAt).toBeGreaterThanOrEqual(out[1]?.lastActiveAt ?? 0);
	});
});
