import type { SessionSaveData } from "../../shared/types";
import { getDb } from "./index";
import * as schema from "./schema";

export type { SessionSaveData };

export function saveTerminalSessions(data: SessionSaveData): void {
	const db = getDb();
	const now = new Date();

	db.transaction((tx) => {
		tx.delete(schema.terminalSessions).run();
		tx.delete(schema.sessionState).run();

		for (const session of data.sessions) {
			tx.insert(schema.terminalSessions)
				.values({
					id: session.id,
					workspaceId: session.workspaceId,
					title: session.title,
					cwd: session.cwd,
					scrollback: session.scrollback,
					sortOrder: session.sortOrder,
					updatedAt: now,
				})
				.run();
		}

		for (const [key, value] of Object.entries(data.state)) {
			tx.insert(schema.sessionState).values({ key, value }).run();
		}
	});
}
