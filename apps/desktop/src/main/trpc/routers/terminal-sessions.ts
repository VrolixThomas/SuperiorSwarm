import { resolve } from "node:path";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../db";
import { savePaneLayouts, saveTerminalSessions } from "../../db/session-persistence";
import { pruneWorktrees } from "../../git/operations";
import { getAgentSessionManager } from "../../services/agent-session-manager-handle";
import { wakeCleanupDaemon } from "../../services/cleanup-daemon-instance";
import { quiesceWorktreeServices } from "../../services/worktree-deletion-coordinator";
import { deleteWorkspaceRecords } from "../../services/worktree-deletion-service";
import { publicProcedure, router } from "../index";

const sessionInput = z.object({
	id: z.string(),
	workspaceId: z.string(),
	title: z.string(),
	cwd: z.string(),
	// scrollback removed — daemon writes this column
	sortOrder: z.number().int(),
});

const saveInput = z.object({
	sessions: z.array(sessionInput),
	state: z.record(z.string(), z.string()),
	paneLayouts: z.record(z.string(), z.string()).optional(),
});

export const terminalSessionsRouter = router({
	save: publicProcedure.input(saveInput).mutation(async ({ input }) => {
		saveTerminalSessions(input);
		if (input.paneLayouts) {
			savePaneLayouts(input.paneLayouts);
		}
		return { ok: true };
	}),

	restore: publicProcedure.query(async () => {
		const db = getDb();

		const persistedSessions = db
			.select()
			.from(schema.terminalSessions)
			.orderBy(schema.terminalSessions.sortOrder)
			.all();

		const stateRows = db.select().from(schema.sessionState).all();
		const state: Record<string, string> = {};
		for (const row of stateRows) {
			state[row.key] = row.value;
		}

		const layoutRows = db.select().from(schema.paneLayouts).all();
		const paneLayouts: Record<string, string> = {};
		for (const row of layoutRows) {
			paneLayouts[row.workspaceId] = row.layout;
		}

		// Build workspace metadata for resolving cwd and type
		const projectRows = db.select().from(schema.projects).all();
		const projectMap: Record<string, (typeof projectRows)[number]> = {};
		for (const p of projectRows) {
			projectMap[p.id] = p;
		}

		const worktreeRows = db.select().from(schema.worktrees).all();
		const worktreeMap: Record<string, (typeof worktreeRows)[number]> = {};
		for (const wt of worktreeRows) {
			worktreeMap[wt.id] = wt;
		}

		const allWorkspaces = db
			.select({
				id: schema.workspaces.id,
				type: schema.workspaces.type,
				projectId: schema.workspaces.projectId,
				worktreeId: schema.workspaces.worktreeId,
				folderPath: schema.workspaces.folderPath,
				prProvider: schema.workspaces.prProvider,
				prIdentifier: schema.workspaces.prIdentifier,
			})
			.from(schema.workspaces)
			.all();
		const validWorkspaceIds = new Set(allWorkspaces.map((workspace) => workspace.id));
		const sessions = persistedSessions.filter((session) =>
			validWorkspaceIds.has(session.workspaceId)
		);
		for (const workspaceId of Object.keys(paneLayouts)) {
			if (!validWorkspaceIds.has(workspaceId)) delete paneLayouts[workspaceId];
		}

		type WorkspaceMeta = {
			type: "repo" | "review";
			cwd: string;
			prProvider?: string;
			prIdentifier?: string;
		};

		const workspaceMeta: Record<string, WorkspaceMeta> = {};
		for (const ws of allWorkspaces) {
			const project = projectMap[ws.projectId];
			if (!project) continue;

			const worktree = ws.worktreeId ? worktreeMap[ws.worktreeId] : null;
			workspaceMeta[ws.id] = {
				type: ws.type === "review" ? "review" : "repo",
				cwd: worktree?.path ?? ws.folderPath ?? project.repoPath,
				prProvider: ws.prProvider ?? undefined,
				prIdentifier: ws.prIdentifier ?? undefined,
			};
		}

		return { sessions, state, paneLayouts, workspaceMeta };
	}),

	listAll: publicProcedure.query(() => {
		const db = getDb();
		const sessions = db.select().from(schema.terminalSessions).all();
		const allWorkspaces = db
			.select({
				id: schema.workspaces.id,
				name: schema.workspaces.name,
				type: schema.workspaces.type,
				prIdentifier: schema.workspaces.prIdentifier,
			})
			.from(schema.workspaces)
			.all();
		const workspaceMap: Record<
			string,
			{ name: string; type: string; prIdentifier: string | null }
		> = {};
		for (const ws of allWorkspaces) {
			workspaceMap[ws.id] = {
				name: ws.name,
				type: ws.type,
				prIdentifier: ws.prIdentifier,
			};
		}
		return { sessions, workspaceMap };
	}),

	listWorktrees: publicProcedure.query(async () => {
		const db = getDb();
		const allProjects = db.select().from(schema.projects).all();
		const dbWorktrees = db.select().from(schema.worktrees).all();
		const allWorkspaces = db
			.select({
				id: schema.workspaces.id,
				name: schema.workspaces.name,
				type: schema.workspaces.type,
				worktreeId: schema.workspaces.worktreeId,
			})
			.from(schema.workspaces)
			.all();

		const { listWorktrees } = await import("../../git/operations");

		const results: Array<{
			path: string;
			branch: string;
			isMain: boolean;
			projectName: string;
			repoPath: string;
			inDb: boolean;
			dbId: string | null;
			workspaceName: string | null;
			workspaceType: string | null;
			existsOnDisk: boolean;
		}> = [];

		// Get disk worktrees per project
		for (const project of allProjects) {
			try {
				const diskWorktrees = await listWorktrees(project.repoPath);
				for (const dw of diskWorktrees) {
					const dbMatch = dbWorktrees.find((db) => db.path === dw.path);
					const wsMatch = dbMatch ? allWorkspaces.find((ws) => ws.worktreeId === dbMatch.id) : null;
					results.push({
						path: dw.path,
						branch: dw.branch,
						isMain: dw.isMain,
						projectName: project.name,
						repoPath: project.repoPath,
						inDb: !!dbMatch,
						dbId: dbMatch?.id ?? null,
						workspaceName: wsMatch?.name ?? null,
						workspaceType: wsMatch?.type ?? null,
						existsOnDisk: true,
					});
				}
			} catch {
				// Project repo might not exist
			}
		}

		// Find DB-only worktrees (in DB but not on disk)
		const diskPaths = new Set(results.map((r) => r.path));
		for (const dbWt of dbWorktrees) {
			if (!diskPaths.has(dbWt.path)) {
				const project = allProjects.find((p) => p.id === dbWt.projectId);
				const wsMatch = allWorkspaces.find((ws) => ws.worktreeId === dbWt.id);
				results.push({
					path: dbWt.path,
					branch: dbWt.branch,
					isMain: false,
					projectName: project?.name ?? "Unknown",
					repoPath: project?.repoPath ?? "",
					inDb: true,
					dbId: dbWt.id,
					workspaceName: wsMatch?.name ?? null,
					workspaceType: wsMatch?.type ?? null,
					existsOnDisk: false,
				});
			}
		}

		return results;
	}),

	removeWorktree: publicProcedure
		.input(z.object({ path: z.string(), repoPath: z.string() }))
		.mutation(async ({ input }) => {
			console.log("[removeWorktree] Removing registered worktree:", input.path);
			const db = getDb();

			// 1. Find DB worktree record by path
			const dbWorktree = db
				.select()
				.from(schema.worktrees)
				.where(eq(schema.worktrees.path, input.path))
				.get();
			const project = dbWorktree
				? db
						.select()
						.from(schema.projects)
						.where(eq(schema.projects.id, dbWorktree.projectId))
						.get()
				: db
						.select()
						.from(schema.projects)
						.where(eq(schema.projects.repoPath, input.repoPath))
						.get();
			if (!project) throw new Error("Project not found for worktree");
			let targetPath = dbWorktree?.path;
			if (!dbWorktree) {
				// Settings can also show Git-registered worktrees missing from our DB.
				// Trust the path only after resolving it against Git using a DB-owned repo.
				const { listWorktrees } = await import("../../git/operations");
				const target = (await listWorktrees(project.repoPath)).find(
					(worktree) => resolve(worktree.path) === resolve(input.path)
				);
				if (!target || target.isMain)
					throw new Error("Worktree is not registered for this project");
				targetPath = target.path;
			}
			if (!targetPath) throw new Error("Worktree path could not be resolved");

			// 2. Remove any linked workspace state and queue durable cleanup.
			const linkedWorkspaces = dbWorktree
				? db
						.select({ id: schema.workspaces.id })
						.from(schema.workspaces)
						.where(eq(schema.workspaces.worktreeId, dbWorktree.id))
						.all()
				: [];

			const linkedWorkspaceIds = linkedWorkspaces.map((workspace) => workspace.id);
			await deleteWorkspaceRecords({
				workspaceIds: linkedWorkspaceIds,
				worktreeId: dbWorktree?.id,
				cleanup: { repoPath: project.repoPath, originalPath: targetPath },
			});

			return { ok: true };
		}),

	listWorktreeCleanupJobs: publicProcedure.query(() => {
		return getDb()
			.select({
				id: schema.worktreeCleanupJobs.id,
				originalPath: schema.worktreeCleanupJobs.originalPath,
				stagingPath: schema.worktreeCleanupJobs.stagingPath,
				status: schema.worktreeCleanupJobs.status,
				phase: schema.worktreeCleanupJobs.phase,
				attempts: schema.worktreeCleanupJobs.attempts,
				lastError: schema.worktreeCleanupJobs.lastError,
				pathReusableAt: schema.worktreeCleanupJobs.pathReusableAt,
				createdAt: schema.worktreeCleanupJobs.createdAt,
				updatedAt: schema.worktreeCleanupJobs.updatedAt,
			})
			.from(schema.worktreeCleanupJobs)
			.where(
				inArray(schema.worktreeCleanupJobs.status, [
					"pending",
					"queued",
					"running",
					"retry_wait",
					"failed",
				])
			)
			.orderBy(desc(schema.worktreeCleanupJobs.createdAt))
			.limit(50)
			.all();
	}),

	retryWorktreeCleanup: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			const job = db
				.select()
				.from(schema.worktreeCleanupJobs)
				.where(eq(schema.worktreeCleanupJobs.id, input.id))
				.get();
			if (!job) throw new Error("Cleanup job not found");
			if (job.status !== "failed") throw new Error("Only failed cleanup jobs can be retried");
			if (!job.pathReusableAt) quiesceWorktreeServices(job.originalPath, job.id);

			db.update(schema.worktreeCleanupJobs)
				.set({
					status: "queued",
					attempts: 0,
					workerId: null,
					leaseExpiresAt: null,
					nextAttemptAt: null,
					lastError: null,
					updatedAt: new Date(),
				})
				.where(eq(schema.worktreeCleanupJobs.id, input.id))
				.run();
			wakeCleanupDaemon();
			return { ok: true };
		}),

	pruneWorktrees: publicProcedure.mutation(async () => {
		const db = getDb();
		const allProjects = db.select().from(schema.projects).all();
		for (const project of allProjects) {
			try {
				await pruneWorktrees(project.repoPath);
			} catch {
				// repo might not exist
			}
		}
		// Delete DB worktree rows whose paths no longer exist on disk
		const { existsSync } = await import("node:fs");
		const dbWorktrees = db.select().from(schema.worktrees).all();
		for (const wt of dbWorktrees) {
			try {
				if (!existsSync(wt.path)) {
					const linkedWorkspaces = db
						.select({ id: schema.workspaces.id })
						.from(schema.workspaces)
						.where(eq(schema.workspaces.worktreeId, wt.id))
						.all();
					for (const workspace of linkedWorkspaces) {
						getAgentSessionManager()?.removeWorkspaceSessions(workspace.id);
					}
					db.delete(schema.worktrees).where(eq(schema.worktrees.id, wt.id)).run();
				}
			} catch {
				// best effort
			}
		}
		return { ok: true };
	}),

	clear: publicProcedure.mutation(async () => {
		const db = getDb();
		db.delete(schema.terminalSessions).run();
		db.delete(schema.sessionState).run();
		db.delete(schema.paneLayouts).run();
		return { ok: true };
	}),
});
