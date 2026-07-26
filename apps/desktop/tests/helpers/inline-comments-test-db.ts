import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { inlineComments } from "../../src/main/db/schema";

export function createInlineCommentsTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.exec(`
		CREATE TABLE inline_comments (
			id TEXT PRIMARY KEY,
			workspace_id TEXT NOT NULL,
			repo_path TEXT NOT NULL,
			file_path TEXT NOT NULL,
			start_line INTEGER NOT NULL,
			end_line INTEGER NOT NULL,
			code_snapshot TEXT NOT NULL,
			body TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			created_at INTEGER NOT NULL,
			sent_at INTEGER
		);
		CREATE INDEX idx_inline_comments_workspace ON inline_comments(workspace_id);
	`);
	return drizzle(sqlite, { schema: { inlineComments } });
}
