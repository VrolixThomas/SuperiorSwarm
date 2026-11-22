import { describe, expect, test } from "bun:test";
import { buildReviewPathLaunchScript } from "../src/main/review-path/launch";

describe("review path launch", () => {
	test("Codex reads the prompt file literally and scopes the MCP task", () => {
		const script = buildReviewPathLaunchScript({
			cli: "codex",
			cwd: "/tmp/repo's $(touch bad)",
			promptFile: "/tmp/prompt's",
			taskToken: "token",
			skipPermissions: false,
		});
		expect(script).toContain("set -eu");
		expect(script).toContain("cd -- '/tmp/repo'\\''s $(touch bad)'");
		expect(script).toContain("export SUPERIORSWARM_TASK_TOKEN='token'");
		expect(script).toContain('exec codex "$(cat --');
		expect(script).not.toContain("danger-full-access");
	});
	test("Claude receives the same scoped prompt and configured permissions", () => {
		const script = buildReviewPathLaunchScript({
			cli: "claude",
			cwd: "/repo",
			promptFile: "/prompt",
			taskToken: "token",
			skipPermissions: true,
		});
		expect(script).toContain('exec claude --dangerously-skip-permissions "$(cat --');
	});
	test("unsupported providers fail explicitly", () => {
		expect(() =>
			buildReviewPathLaunchScript({
				cli: "gemini",
				cwd: "/repo",
				promptFile: "/prompt",
				taskToken: "token",
				skipPermissions: false,
			})
		).toThrow("not supported");
	});
});

test("launch script executes fake Codex/Claude with exact prompt bytes and isolated token", async () => {
	const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const root = mkdtempSync(join(tmpdir(), "review-path-launch-"));
	try {
		for (const cli of ["codex", "claude"] as const) {
			const executable = join(root, cli);
			writeFileSync(
				executable,
				'#!/bin/bash\nprintf "%s" "$SUPERIORSWARM_TASK_TOKEN" > "$CAPTURE_TOKEN"\nprintf "%s" "$1" > "$CAPTURE_PROMPT"\n',
				{ mode: 0o700 }
			);
			const promptFile = join(root, "prompt's.txt");
			const prompt = "Question: 'literal' $(touch should-not-exist) `printf bad`\nhead: abc";
			writeFileSync(promptFile, prompt);
			const script = join(root, "launch.sh");
			writeFileSync(
				script,
				buildReviewPathLaunchScript({
					cli,
					cwd: root,
					promptFile,
					taskToken: "owned-task",
					skipPermissions: false,
				})
			);
			const child = Bun.spawn(["/bin/bash", script], {
				env: {
					...Bun.env,
					PATH: `${root}:${Bun.env["PATH"]}`,
					CAPTURE_TOKEN: join(root, "token"),
					CAPTURE_PROMPT: join(root, "prompt-captured"),
				},
				stdout: "pipe",
				stderr: "pipe",
			});
			expect(await child.exited).toBe(0);
			expect(readFileSync(join(root, "prompt-captured"), "utf8")).toBe(prompt);
			expect(readFileSync(join(root, "token"), "utf8")).toBe("owned-task");
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
