import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { reviewViewed } from "../../src/main/db/schema";

export function createReviewTestDb() {
	const sqlite = new Database(":memory:");
	sqlite.exec(`
		CREATE TABLE review_viewed (
			workspace_id TEXT NOT NULL,
			file_path TEXT NOT NULL,
			content_hash TEXT NOT NULL,
			viewed_at INTEGER NOT NULL,
			PRIMARY KEY (workspace_id, file_path)
		);
		CREATE INDEX idx_review_viewed_workspace ON review_viewed(workspace_id);
	`);
	return drizzle(sqlite, { schema: { reviewViewed } });
}
