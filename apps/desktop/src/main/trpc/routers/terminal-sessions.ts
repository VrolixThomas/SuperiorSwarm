import { eq } from "drizzle-orm";
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
		const repoWorkspaces = db
			.select({
				id: schema.workspaces.id,
				worktreePath: schema.worktrees.path,
				repoPath: schema.projects.repoPath,
			})
			.from(schema.workspaces)
			.leftJoin(schema.worktrees, eq(schema.workspaces.worktreeId, schema.worktrees.id))
			.leftJoin(schema.projects, eq(schema.workspaces.projectId, schema.projects.id))
			.all();

		const rvWorkspaces = db
			.select({
				id: schema.reviewWorkspaces.id,
				worktreePath: schema.worktrees.path,
				repoPath: schema.projects.repoPath,
				prProvider: schema.reviewWorkspaces.prProvider,
				prIdentifier: schema.reviewWorkspaces.prIdentifier,
			})
			.from(schema.reviewWorkspaces)
			.leftJoin(schema.worktrees, eq(schema.reviewWorkspaces.worktreeId, schema.worktrees.id))
			.leftJoin(schema.projects, eq(schema.reviewWorkspaces.projectId, schema.projects.id))
			.all();

		const workspaceMeta: Record<
			string,
			{
				type: "repo" | "review";
				cwd: string;
				prProvider?: string;
				prIdentifier?: string;
			}
		> = {};

		for (const ws of repoWorkspaces) {
			workspaceMeta[ws.id] = {
				type: "repo",
				cwd: ws.worktreePath ?? ws.repoPath ?? "",
			};
		}
		for (const rw of rvWorkspaces) {
			workspaceMeta[rw.id] = {
				type: "review",
				cwd: rw.worktreePath ?? rw.repoPath ?? "",
				prProvider: rw.prProvider,
				prIdentifier: rw.prIdentifier,
			};
		}

		return { sessions, state, paneLayouts, workspaceMeta };
	}),

	clear: publicProcedure.mutation(async () => {
		const db = getDb();
		db.delete(schema.terminalSessions).run();
		db.delete(schema.sessionState).run();
		db.delete(schema.paneLayouts).run();
		return { ok: true };
	}),
});
