import "./preload-electron-mock";
import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { _setDbForTesting } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import type { AgentSessionManager } from "../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../src/main/services/agent-session-manager-handle";
import { resumeWorktreeServices } from "../src/main/services/worktree-deletion-coordinator";
import { t } from "../src/main/trpc";
import { terminalSessionsRouter } from "../src/main/trpc/routers/terminal-sessions";

const roots: string[] = [];

afterEach(() => {
	_setDbForTesting(null);
	setAgentSessionManager(null);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("terminalSessions.removeWorktree", () => {
	test("queues a Git-registered worktree that has no database row", async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-remove-orphan-worktree-"));
		roots.push(root);
		const repoPath = join(root, "repo");
		const worktreePath = join(root, "repo-worktrees", "orphan");
		execFileSync("git", ["init", "-q", "-b", "main", repoPath]);
		execFileSync("git", ["-C", repoPath, "config", "user.email", "test@example.com"]);
		execFileSync("git", ["-C", repoPath, "config", "user.name", "Test"]);
		writeFileSync(join(repoPath, "README.md"), "main\n");
		execFileSync("git", ["-C", repoPath, "add", "README.md"]);
		execFileSync("git", ["-C", repoPath, "commit", "-q", "-m", "initial"]);
		execFileSync("git", ["-C", repoPath, "worktree", "add", "-q", "-b", "orphan", worktreePath]);
		const registeredPath = realpathSync(worktreePath);

		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		_setDbForTesting(db);
		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: "project-orphan",
				name: "Orphan Worktree Project",
				repoPath,
				defaultBranch: "main",
				status: "ready",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		const caller = t.createCallerFactory(terminalSessionsRouter)({});
		try {
			const result = await caller.removeWorktree({ path: registeredPath, repoPath });
			expect(result).toEqual({ ok: true });

			const jobs = db.select().from(schema.worktreeCleanupJobs).all();
			expect(jobs).toHaveLength(1);
			expect(jobs[0]?.originalPath).toBe(resolve(registeredPath));
			expect(db.select().from(schema.worktrees).all()).toHaveLength(0);
		} finally {
			resumeWorktreeServices(worktreePath);
			sqlite.close();
		}
	});

	test("clears tracked agent state using IDs captured before the worktree cascade", async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-remove-tracked-worktree-"));
		roots.push(root);
		const repoPath = join(root, "repo");
		const worktreePath = join(root, "repo-worktrees", "tracked");
		execFileSync("git", ["init", "-q", "-b", "main", repoPath]);
		execFileSync("git", ["-C", repoPath, "config", "user.email", "test@example.com"]);
		execFileSync("git", ["-C", repoPath, "config", "user.name", "Test"]);
		writeFileSync(join(repoPath, "README.md"), "main\n");
		execFileSync("git", ["-C", repoPath, "add", "README.md"]);
		execFileSync("git", ["-C", repoPath, "commit", "-q", "-m", "initial"]);
		execFileSync("git", ["-C", repoPath, "worktree", "add", "-q", "-b", "tracked", worktreePath]);
		const registeredPath = realpathSync(worktreePath);

		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		_setDbForTesting(db);
		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: "project-tracked",
				name: "Tracked Worktree Project",
				repoPath,
				defaultBranch: "main",
				status: "ready",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.worktrees)
			.values({
				id: "worktree-tracked",
				projectId: "project-tracked",
				path: registeredPath,
				branch: "tracked",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.workspaces)
			.values({
				id: "workspace-tracked",
				projectId: "project-tracked",
				type: "worktree",
				name: "tracked",
				worktreeId: "worktree-tracked",
				terminalId: null,
				currentPhase: "idle",
				isOrchestrator: false,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.agentSessions)
			.values({
				terminalId: "agent-term-tracked",
				workspaceId: "workspace-tracked",
				provider: "codex",
				providerSessionId: "provider-tracked",
				state: "idle",
				lastEventAt: now,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		let clearedAgentIds: readonly string[] = [];
		let worktreeWasAlreadyDeleted = false;
		setAgentSessionManager({
			removeSessions(terminalIds: readonly string[]) {
				clearedAgentIds = terminalIds;
				worktreeWasAlreadyDeleted = db.select().from(schema.worktrees).all().length === 0;
			},
		} as unknown as AgentSessionManager);

		const caller = t.createCallerFactory(terminalSessionsRouter)({});
		try {
			await expect(caller.removeWorktree({ path: registeredPath, repoPath })).resolves.toEqual({
				ok: true,
			});
			expect(clearedAgentIds).toEqual(["agent-term-tracked"]);
			expect(worktreeWasAlreadyDeleted).toBe(true);
		} finally {
			resumeWorktreeServices(worktreePath);
			sqlite.close();
		}
	});
});
