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
});
