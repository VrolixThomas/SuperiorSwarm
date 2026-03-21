import { z } from "zod";
import { getDb, schema } from "../../db";
import { savePaneLayouts, saveTerminalSessions } from "../../db/session-persistence";
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

	clear: publicProcedure.mutation(async () => {
		const db = getDb();
		db.delete(schema.terminalSessions).run();
		db.delete(schema.sessionState).run();
		db.delete(schema.paneLayouts).run();
		return { ok: true };
	}),
});
