import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import simpleGit from "simple-git";
import { getDb, schema } from "../src/main/db";
import { initRepo } from "../src/main/git/operations";
import {
	createWorkspace,
	dispatchAgent,
	getWorkspace,
	listWorkspaces,
	removeWorkspace,
} from "../src/main/services/workspace-service";

let TMP: string;
let REPO: string;
let PROJECT_ID: string;

beforeAll(() => {
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
});

beforeEach(async () => {
	TMP = mkdtempSync(join(tmpdir(), "ws-svc-"));
	REPO = join(TMP, "repo");
	mkdirSync(REPO, { recursive: true });
	await initRepo(REPO, "main");
	await simpleGit(REPO).raw(["commit", "--allow-empty", "-m", "init"]);

	PROJECT_ID = `proj-${nanoid(8)}`;
	const db = getDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: PROJECT_ID,
			repoPath: REPO,
			name: "repo",
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
});

afterEach(() => {
	const db = getDb();
	db.delete(schema.projects).where(eq(schema.projects.id, PROJECT_ID)).run();
	rmSync(TMP, { recursive: true, force: true });
});

describe("createWorkspace", () => {
	test("creates worktree, workspace, and worktree DB rows", async () => {
		const result = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/x",
			baseBranch: "main",
		});

		expect(result.branch).toBe("feature/x");
		expect(result.baseBranch).toBe("main");
		expect(result.path.endsWith("/feature/x")).toBe(true);

		const db = getDb();
		const ws = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.projectId, PROJECT_ID))
			.all();
		expect(ws).toHaveLength(1);
		expect(ws[0]?.name).toBe("feature/x");
	});

	test("uses project default branch when baseBranch omitted", async () => {
		const result = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/y" });
		expect(result.baseBranch).toBe("main");
	});

	test("throws when project does not exist", async () => {
		await expect(createWorkspace({ projectId: "missing", branch: "feature/z" })).rejects.toThrow(
			/not found/i
		);
	});
});

describe("listWorkspaces", () => {
	test("returns workspaces for the given project only", async () => {
		await createWorkspace({ projectId: PROJECT_ID, branch: "feature/a" });
		await createWorkspace({ projectId: PROJECT_ID, branch: "feature/b" });

		const { workspaces: list } = await listWorkspaces({ projectId: PROJECT_ID });
		expect(list).toHaveLength(2);
		expect(list.map((w) => w.name).sort()).toEqual(["feature/a", "feature/b"]);
	});

	test("returns empty list for project with no workspaces", async () => {
		const { workspaces: list } = await listWorkspaces({ projectId: PROJECT_ID });
		expect(list).toEqual([]);
	});
});

describe("getWorkspace", () => {
	test("returns workspace + dirty flag", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/c" });
		const ws = await getWorkspace({ projectId: PROJECT_ID, workspaceId: created.workspaceId });
		expect(ws.id).toBe(created.workspaceId);
		expect(ws.worktreePath).toBe(created.path);
		expect(ws.hasUncommittedChanges).toBe(false);
	});

	test("throws not_found for unknown id", async () => {
		await expect(getWorkspace({ projectId: PROJECT_ID, workspaceId: "missing" })).rejects.toThrow(
			/not_found/
		);
	});

	test("throws forbidden when projectId mismatches", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/d" });
		await expect(
			getWorkspace({ projectId: "other-proj", workspaceId: created.workspaceId })
		).rejects.toThrow(/forbidden/);
	});
});

describe("removeWorkspace", () => {
	test("removes worktree and DB rows", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r1" });
		const result = await removeWorkspace({
			projectId: PROJECT_ID,
			workspaceId: created.workspaceId,
		});
		expect(result.status).toBe("removed");

		const { workspaces: list } = await listWorkspaces({ projectId: PROJECT_ID });
		expect(list).toEqual([]);
	});

	test("blocks on uncommitted changes without force", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r2" });
		const fs = await import("node:fs");
		fs.writeFileSync(join(created.path, "dirty.txt"), "x");

		const result = await removeWorkspace({
			projectId: PROJECT_ID,
			workspaceId: created.workspaceId,
		});
		expect(result.status).toBe("blocked_uncommitted");
	});

	test("force=true bypasses dirty guard", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r3" });
		const fs = await import("node:fs");
		fs.writeFileSync(join(created.path, "dirty.txt"), "x");

		const result = await removeWorkspace({
			projectId: PROJECT_ID,
			workspaceId: created.workspaceId,
			force: true,
		});
		expect(result.status).toBe("removed");
	});

	test("forbidden across projects", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/r4" });
		await expect(
			removeWorkspace({ projectId: "other", workspaceId: created.workspaceId })
		).rejects.toThrow(/forbidden/);
	});

	test("removes orphan workspace (worktreeId set but worktrees row missing)", async () => {
		const db = getDb();
		const workspaceId = `ws-orphan-${nanoid(8)}`;
		const now = new Date();
		// Disable FK enforcement temporarily so we can insert an orphan row
		// (worktreeId points to a non-existent worktrees row).
		db.run("PRAGMA foreign_keys = OFF");
		db.insert(schema.workspaces)
			.values({
				id: workspaceId,
				projectId: PROJECT_ID,
				type: "worktree",
				name: "orphan",
				worktreeId: "never-existed",
				terminalId: null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.run("PRAGMA foreign_keys = ON");

		const result = await removeWorkspace({
			projectId: PROJECT_ID,
			workspaceId,
		});
		expect(result.status).toBe("removed");

		const remaining = db
			.select()
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, workspaceId))
			.all();
		expect(remaining).toHaveLength(0);
	});
});

describe("dispatchAgent", () => {
	test("calls spawnFn with workspace cwd + cli command", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/d1" });
		const calls: Array<{ cwd: string; script: string }> = [];

		const result = await dispatchAgent(
			{
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "Refactor the foo module",
				cliPreset: "claude",
			},
			{
				spawnFn: async ({ cwd, launchScriptContent }) => {
					calls.push({ cwd, script: launchScriptContent });
					return { sessionId: "sess-1", terminalId: "term-1" };
				},
			}
		);

		expect(result.sessionId).toBe("sess-1");
		expect(result.terminalId).toBe("term-1");
		expect(result.status).toBe("started");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.cwd).toBe(created.path);
		expect(calls[0]?.script).toContain("claude");
		expect(calls[0]?.script).toContain("Refactor the foo module");

		// NEW: workspace row should now have a cli_session_id and cli_preset=claude
		const db = getDb();
		const row = db
			.select({
				cliSessionId: schema.workspaces.cliSessionId,
				cliPreset: schema.workspaces.cliPreset,
			})
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, created.workspaceId))
			.get();
		expect(row?.cliPreset).toBe("claude");
		expect(row?.cliSessionId).toBeTruthy();
		expect(row?.cliSessionId).toMatch(/^[0-9a-f-]{36}$/);

		// AND the launch script should embed --session-id (interactive — no --print on dispatch)
		expect(calls[0]?.script).toContain("--session-id");
		expect(calls[0]?.script).not.toContain("--print");
		expect(calls[0]?.script).toContain(row?.cliSessionId ?? "");
		// AND skipPermissions defaults to true for dispatched claude agents
		expect(calls[0]?.script).toContain("--dangerously-skip-permissions");
	});

	test("does NOT include orchestrator preamble for non-orchestrator workspaces", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/no-preamble" });
		let captured = "";
		await dispatchAgent(
			{
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "ordinary task",
				cliPreset: "claude",
			},
			{
				spawnFn: async ({ launchScriptContent }) => {
					captured = launchScriptContent;
					return { sessionId: "s", terminalId: "t" };
				},
			}
		);
		expect(captured).not.toContain("SuperiorSwarm orchestrator preamble");
		expect(captured).toContain("ordinary task");
	});

	test("orchestrator workspace gets coordination preamble in prompt", async () => {
		const created = await createWorkspace({
			projectId: PROJECT_ID,
			branch: "feature/orch-preamble",
		});
		const db = getDb();
		db.update(schema.workspaces)
			.set({ isOrchestrator: true })
			.where(eq(schema.workspaces.id, created.workspaceId))
			.run();

		let captured = "";
		await dispatchAgent(
			{
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "coordinate the team",
				cliPreset: "claude",
			},
			{
				spawnFn: async ({ launchScriptContent }) => {
					captured = launchScriptContent;
					return { sessionId: "s", terminalId: "t" };
				},
			}
		);
		expect(captured).toContain("SuperiorSwarm orchestrator preamble");
		expect(captured).toContain(".ss-events.jsonl");
		expect(captured).toContain("Monitor");
		expect(captured).toContain("coordinate the team");
	});

	test("forbidden across projects", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/d2" });
		await expect(
			dispatchAgent(
				{
					projectId: "other",
					workspaceId: created.workspaceId,
					prompt: "x",
					cliPreset: "claude",
				},
				{ spawnFn: async () => ({ sessionId: "s", terminalId: "t" }) }
			)
		).rejects.toThrow(/forbidden/);
	});

	test("includes correct permission flag per preset", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/d3" });

		let geminiScript = "";
		await dispatchAgent(
			{
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "p",
				cliPreset: "gemini",
				skipPermissions: true,
			},
			{
				spawnFn: async ({ launchScriptContent }) => {
					geminiScript = launchScriptContent;
					return { sessionId: "s", terminalId: "t" };
				},
			}
		);
		expect(geminiScript).toContain("--yolo");

		let opencodeScript = "";
		await dispatchAgent(
			{
				projectId: PROJECT_ID,
				workspaceId: created.workspaceId,
				prompt: "p",
				cliPreset: "opencode",
				skipPermissions: true,
			},
			{
				spawnFn: async ({ launchScriptContent }) => {
					opencodeScript = launchScriptContent;
					return { sessionId: "s", terminalId: "t" };
				},
			}
		);
		// opencode has no permissionFlag — script should not contain any flag string
		expect(opencodeScript).not.toContain("--yolo");
		expect(opencodeScript).not.toContain("--dangerously-skip-permissions");
		expect(opencodeScript).not.toContain("--full-auto");
	});

	test("does not persist cliSessionId if spawn throws", async () => {
		const created = await createWorkspace({ projectId: PROJECT_ID, branch: "feature/d4" });
		const throwingSpawn = async () => {
			throw new Error("simulated spawn failure");
		};
		await expect(
			dispatchAgent(
				{
					projectId: PROJECT_ID,
					workspaceId: created.workspaceId,
					prompt: "x",
					cliPreset: "claude",
				},
				{ spawnFn: throwingSpawn }
			)
		).rejects.toThrow(/simulated spawn failure/);

		const db = getDb();
		const row = db
			.select({ cliSessionId: schema.workspaces.cliSessionId })
			.from(schema.workspaces)
			.where(eq(schema.workspaces.id, created.workspaceId))
			.get();
		expect(row?.cliSessionId).toBeNull();
	});
});
