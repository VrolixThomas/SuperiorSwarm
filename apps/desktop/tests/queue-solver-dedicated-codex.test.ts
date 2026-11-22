import "./preload-electron-mock";
import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { TaskRegistry } from "../src/main/control-plane/task-registry";
import { getDb } from "../src/main/db";
import {
	aiReviewSettings,
	commentSolveSessions,
	workspaces,
	worktrees,
} from "../src/main/db/schema";
import { setTaskRegistry } from "../src/main/services/task-registry-handle";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
mock.module("../src/main/ai-review/mcp-path", () => ({
	getMcpServerPath: () => "/synthetic/server.mjs",
}));
const { queueSolve } = await import("../src/main/ai-review/comment-solver-orchestrator");
const dirs: string[] = [];
beforeAll(() => {
	setupTestDb();
	setTaskRegistry(new TaskRegistry());
});
afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
for (const provider of ["codex", "claude"] as const)
	for (const skipPermissions of [false, true])
		test(`${provider} solver keeps permission policy and ${provider === "codex" ? "uses one dedicated daemon flag" : "keeps Claude invocation unchanged"} (${skipPermissions})`, async () => {
			const root = mkdtempSync(join(tmpdir(), "ss-solver-argv-"));
			dirs.push(root);
			const cwd = join(root, "repo");
			mkdirSync(cwd);
			execFileSync("git", ["init", "-q", cwd]);
			execFileSync("git", [
				"-C",
				cwd,
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"commit",
				"--allow-empty",
				"-qm",
				"fixture",
			]);
			const projectId = await seedProject();
			const workspaceId = await seedWorkspace(projectId, { name: "Solver argv" });
			const worktreeId = randomUUID();
			const sessionId = randomUUID();
			const now = new Date();
			getDb()
				.insert(worktrees)
				.values({
					id: worktreeId,
					projectId,
					path: cwd,
					branch: "fixture",
					baseBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			getDb().update(workspaces).set({ worktreeId }).where(eq(workspaces.id, workspaceId)).run();
			getDb()
				.insert(commentSolveSessions)
				.values({
					id: sessionId,
					workspaceId,
					prProvider: "github",
					prIdentifier: "fixture/repo#1",
					prTitle: "Fixture",
					sourceBranch: "fixture",
					targetBranch: "main",
					status: "queued",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			getDb()
				.insert(aiReviewSettings)
				.values({
					id: "default",
					cliPreset: provider,
					skipPermissions: skipPermissions ? 1 : 0,
					solvePrompt: "Fixture prompt",
				})
				.onConflictDoUpdate({
					target: aiReviewSettings.id,
					set: {
						cliPreset: provider,
						skipPermissions: skipPermissions ? 1 : 0,
						solvePrompt: "Fixture prompt",
					},
				})
				.run();
			const launch = await queueSolve(sessionId);
			dirs.push(dirname(launch.launchScript));
			const bin = join(root, "bin");
			mkdirSync(bin);
			const output = join(root, "argv.json");
			writeFileSync(
				join(bin, provider),
				`#!${process.execPath}\nawait Bun.write(process.env.PROBE_OUTPUT, JSON.stringify(process.argv.slice(2)));\n`,
				{ mode: 0o700 }
			);
			execFileSync("/bin/bash", [launch.launchScript], {
				cwd,
				env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, PROBE_OUTPUT: output },
			});
			const argv = JSON.parse(readFileSync(output, "utf8")) as string[];
			expect(argv.filter((arg) => arg === "--no-daemon")).toHaveLength(
				provider === "codex" ? 1 : 0
			);
			expect(argv.some((arg) => arg === "--daemon")).toBe(false);
			if (provider === "codex") {
				expect(argv[0]).toBe("--no-daemon");
				expect(argv.includes("approval_policy=never")).toBe(skipPermissions);
				expect(argv.includes("sandbox_mode=danger-full-access")).toBe(skipPermissions);
				expect(argv.filter((arg) => arg === "-c")).toHaveLength(skipPermissions ? 2 : 0);
			} else {
				expect(argv.includes("--dangerously-skip-permissions")).toBe(skipPermissions);
				expect(argv).toHaveLength(skipPermissions ? 2 : 1);
			}
			expect(argv.at(-1)).toContain(provider === "codex" ? "Fixture prompt" : "Read ");
		});
