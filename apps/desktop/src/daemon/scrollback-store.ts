import Database from "better-sqlite3";

export class ScrollbackStore {
	private db: Database.Database;
	private stmt: Database.Statement;
	private ownsDb: boolean;

	// Accept an already-opened database (for testing) or a path string.
	constructor(dbOrPath: Database.Database | string) {
		if (typeof dbOrPath === "string") {
			this.db = new Database(dbOrPath);
			this.db.pragma("journal_mode = WAL");
			this.db.pragma("foreign_keys = ON");
			this.ownsDb = true;
		} else {
			this.db = dbOrPath;
			this.ownsDb = false;
		}
		// Stamp updated_at (epoch seconds, matching drizzle's timestamp mode) so
		// "most recently updated session" reflects actual output recency — the
		// control plane's agent_output picks its session by this column.
		this.stmt = this.db.prepare(
			"UPDATE terminal_sessions SET scrollback = ?, updated_at = ? WHERE id = ?"
		);
	}

	flush(sessions: Array<{ id: string; buffer: string }>): void {
		const now = Math.floor(Date.now() / 1000);
		const tx = this.db.transaction(() => {
			for (const { id, buffer } of sessions) {
				if (buffer.length > 0) {
					this.stmt.run(buffer, now, id);
				}
			}
		});
		tx();
	}

	close(): void {
		if (this.ownsDb && this.db.open) {
			this.db.close();
		}
	}
}
