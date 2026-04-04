import { and, ne, notInArray, notLike } from "drizzle-orm";
import type { SessionSaveData } from "../../shared/types";
import { getDb } from "./index";
import * as schema from "./schema";

export type { SessionSaveData };

export function savePaneLayouts(layouts: Record<string, string>): void {
	const db = getDb();
	const now = new Date();
	db.transaction((tx) => {
		for (const [workspaceId, layoutJson] of Object.entries(layouts)) {
			tx.insert(schema.paneLayouts)
				.values({ workspaceId, layout: layoutJson, updatedAt: now })
				.onConflictDoUpdate({
					target: schema.paneLayouts.workspaceId,
					set: { layout: layoutJson, updatedAt: now },
				})
				.run();
		}
	});
}

export function saveTerminalSessions(data: SessionSaveData): void {
	const db = getDb();
	const now = new Date();
	const currentIds = data.sessions.map((s) => s.id);

	db.transaction((tx) => {
		// Delete sessions no longer open
		if (currentIds.length > 0) {
			tx.delete(schema.terminalSessions)
				.where(notInArray(schema.terminalSessions.id, currentIds))
				.run();
		} else {
			tx.delete(schema.terminalSessions).run();
		}

		// Upsert open sessions — deliberately NOT touching scrollback (daemon owns it)
		for (const session of data.sessions) {
			tx.insert(schema.terminalSessions)
				.values({
					id: session.id,
					workspaceId: session.workspaceId,
					title: session.title,
					cwd: session.cwd,
					scrollback: null,
					sortOrder: session.sortOrder,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: schema.terminalSessions.id,
					set: {
						workspaceId: session.workspaceId,
						title: session.title,
						cwd: session.cwd,
						sortOrder: session.sortOrder,
						updatedAt: now,
						// scrollback intentionally omitted — daemon owns it
					},
				})
				.run();
		}

		// Session state: replace entirely (renderer owns this)
		// Preserve supabase_session: keys (Supabase auth) and lastSeenVersion (updater)
		tx.delete(schema.sessionState)
			.where(
				and(
					notLike(schema.sessionState.key, "supabase_session:%"),
					ne(schema.sessionState.key, "lastSeenVersion"),
				),
			)
			.run();
		for (const [key, value] of Object.entries(data.state)) {
			tx.insert(schema.sessionState).values({ key, value }).run();
		}
	});
}
