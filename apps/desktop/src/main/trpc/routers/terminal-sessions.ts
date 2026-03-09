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

		return { sessions, state, paneLayouts };
	}),

	clear: publicProcedure.mutation(async () => {
		const db = getDb();
		db.delete(schema.terminalSessions).run();
		db.delete(schema.sessionState).run();
		db.delete(schema.paneLayouts).run();
		return { ok: true };
	}),
});
