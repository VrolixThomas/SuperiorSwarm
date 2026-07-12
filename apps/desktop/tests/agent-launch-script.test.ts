import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import {
	buildAgentLaunchScript,
	writeAgentLaunchScript,
} from "../src/main/agent-launch/launch-script";

describe("buildAgentLaunchScript", () => {
	test("claude new agent: skip-permissions flag + quoted prompt, cd to cwd", () => {
		const s = buildAgentLaunchScript({ cwd: "/tmp/w", cli: "claude", prompt: "fix the bug" });
		expect(s).toContain("cd '/tmp/w'");
		expect(s).toContain("claude --dangerously-skip-permissions 'fix the bug'");
		expect(s.startsWith("#!/bin/bash")).toBe(true);
	});

	test("claude resume includes --resume with id before flags", () => {
		const s = buildAgentLaunchScript({
			cwd: "/tmp/w",
			cli: "claude",
			prompt: "p",
			resumeSessionId: "abc-123",
		});
		expect(s).toContain("claude --resume 'abc-123' --dangerously-skip-permissions 'p'");
	});

	test("codex new + resume use config-override flags / resume subcommand", () => {
		expect(buildAgentLaunchScript({ cwd: "/w", cli: "codex", prompt: "p" })).toContain(
			"codex -c approval_policy=never -c sandbox_mode=danger-full-access 'p'"
		);
		expect(
			buildAgentLaunchScript({ cwd: "/w", cli: "codex", prompt: "p", resumeSessionId: "id9" })
		).toContain(
			"codex resume 'id9' -c approval_policy=never -c sandbox_mode=danger-full-access 'p'"
		);
	});

	test("gemini positional prompt with --yolo; opencode uses run subcommand without flags", () => {
		expect(buildAgentLaunchScript({ cwd: "/w", cli: "gemini", prompt: "p" })).toContain(
			"gemini --yolo 'p'"
		);
		expect(buildAgentLaunchScript({ cwd: "/w", cli: "opencode", prompt: "p" })).toContain(
			"opencode run 'p'"
		);
	});

	test("escapes single quotes, newlines and dollar signs survive literally", () => {
		const s = buildAgentLaunchScript({ cwd: "/w", cli: "claude", prompt: "it's $HOME\nline2" });
		expect(s).toContain("'it'\\''s $HOME\nline2'");
	});

	test("resume throws for gemini and opencode", () => {
		expect(() =>
			buildAgentLaunchScript({ cwd: "/w", cli: "gemini", prompt: "p", resumeSessionId: "x" })
		).toThrow();
		expect(() =>
			buildAgentLaunchScript({ cwd: "/w", cli: "opencode", prompt: "p", resumeSessionId: "x" })
		).toThrow();
	});
});

describe("writeAgentLaunchScript", () => {
	test("writes executable script and returns path", () => {
		const p = writeAgentLaunchScript("#!/bin/bash\necho hi\n");
		expect(readFileSync(p, "utf-8")).toContain("echo hi");
		expect(statSync(p).mode & 0o111).toBeTruthy();
	});
});
