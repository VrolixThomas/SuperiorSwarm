import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../../db";
import { savePaneLayouts, saveTerminalSessions } from "../../db/session-persistence";
import { removeWorktree } from "../../git/operations";
import { getDaemonClient } from "../../terminal/daemon-instance";
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

		const sessions = db
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
				prProvider: schema.workspaces.prProvider,
				prIdentifier: schema.workspaces.prIdentifier,
			})
			.from(schema.workspaces)
			.all();

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
				cwd: worktree?.path ?? project.repoPath,
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
			console.log("[removeWorktree] Removing:", input.path, "from repo:", input.repoPath);
			const db = getDb();

			// 1. Find DB worktree record by path
			const dbWorktree = db
				.select()
				.from(schema.worktrees)
				.where(eq(schema.worktrees.path, input.path))
				.get();
			console.log("[removeWorktree] DB record:", dbWorktree ? "found" : "not found");

			// 2. Dispose any daemon terminals for workspaces using this worktree
			if (dbWorktree) {
				const linkedWorkspaces = db
					.select({ id: schema.workspaces.id })
					.from(schema.workspaces)
					.where(eq(schema.workspaces.worktreeId, dbWorktree.id))
					.all();

				const daemon = getDaemonClient();
				for (const ws of linkedWorkspaces) {
					const sessions = db
						.select({ id: schema.terminalSessions.id })
						.from(schema.terminalSessions)
						.where(eq(schema.terminalSessions.workspaceId, ws.id))
						.all();
					for (const s of sessions) {
						daemon?.dispose(s.id);
					}
					db.delete(schema.terminalSessions)
						.where(eq(schema.terminalSessions.workspaceId, ws.id))
						.run();
				}
			}

			// 3. Remove worktree from disk
			const { existsSync, rmSync } = await import("node:fs");
			if (existsSync(input.path)) {
				try {
					await removeWorktree(input.repoPath, input.path);
				} catch {
					// Force remove if git worktree remove fails
					rmSync(input.path, { recursive: true, force: true });
					const { default: simpleGit } = await import("simple-git");
					await simpleGit(input.repoPath)
						.raw(["worktree", "prune"])
						.catch(() => {});
				}
			}

			// 4. Delete DB records (cascade deletes workspaces)
			if (dbWorktree) {
				db.delete(schema.worktrees).where(eq(schema.worktrees.id, dbWorktree.id)).run();
			}

			return { ok: true };
		}),

	pruneWorktrees: publicProcedure.mutation(async () => {
		const db = getDb();
		const allProjects = db.select().from(schema.projects).all();
		const { default: simpleGit } = await import("simple-git");
		for (const project of allProjects) {
			try {
				await simpleGit(project.repoPath).raw(["worktree", "prune"]);
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
