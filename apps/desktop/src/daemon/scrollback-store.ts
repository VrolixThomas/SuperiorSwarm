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
		this.stmt = this.db.prepare("UPDATE terminal_sessions SET scrollback = ? WHERE id = ?");
	}

	flush(sessions: Array<{ id: string; cwd: string; buffer: string }>): void {
		const tx = this.db.transaction(() => {
			for (const { id, buffer } of sessions) {
				if (buffer.length > 0) {
					this.stmt.run(buffer, id);
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
