import { describe, expect, test } from "bun:test";
import { buildLaunchScript } from "../src/main/services/workspace-service";

describe("buildLaunchScript", () => {
	test("codex preset omits removed --full-auto flag", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/some/worktree",
			cliPreset: "codex",
			prompt: "hello",
			skipPermissions: true,
			cliSessionId: null,
		});
		expect(out).not.toContain("--full-auto");
	});

	test("codex preset emits -c approval_policy when skipPermissions", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/some/worktree",
			cliPreset: "codex",
			prompt: "hello",
			skipPermissions: true,
			cliSessionId: null,
		});
		expect(out).toMatch(/-c approval_policy=never/);
	});

	test("codex preset emits -c sandbox_mode when skipPermissions", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/some/worktree",
			cliPreset: "codex",
			prompt: "hello",
			skipPermissions: true,
			cliSessionId: null,
		});
		expect(out).toMatch(/-c sandbox_mode=danger-full-access/);
	});

	test("codex preset omits flags when skipPermissions is false", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/some/worktree",
			cliPreset: "codex",
			prompt: "hello",
			skipPermissions: false,
			cliSessionId: null,
		});
		expect(out).not.toContain("approval_policy");
		expect(out).not.toContain("sandbox_mode");
	});

	test("opencode preset uses 'opencode run' subcommand", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/some/worktree",
			cliPreset: "opencode",
			prompt: "hello world",
			skipPermissions: true,
			cliSessionId: null,
		});
		// Match the command line specifically (must start with `opencode run`)
		expect(out).toMatch(/^opencode run /m);
	});

	test("opencode prompt is single-quoted, not appended to cd line", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/work",
			cliPreset: "opencode",
			prompt: "multi\nline\nprompt",
			skipPermissions: true,
			cliSessionId: null,
		});
		const lines = out.split("\n");
		const cdLine = lines.find((l) => l.startsWith("cd "));
		expect(cdLine).toBe("cd '/tmp/work'");
	});

	test("non-opencode preset (claude) does not use 'run' subcommand", () => {
		const out = buildLaunchScript({
			cwd: "/tmp/work",
			cliPreset: "claude",
			prompt: "hi",
			skipPermissions: true,
			cliSessionId: null,
		});
		expect(out).not.toMatch(/^claude run /m);
	});
});
