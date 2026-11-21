import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { getDb } from "../../src/main/db";
import * as schema from "../../src/main/db/schema";
import { ReviewPathStorage } from "../../src/main/review-path/storage";
import type { ReviewPathIdentity } from "../../src/shared/review-path-runtime";

export const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
export const agent = { id: "codex", label: "Codex" };
export function authorityFixture() {
	const root = mkdtempSync(join(tmpdir(), "reading-authority-"));
	const sql = new Database(join(root, "test.db"));
	const raw = drizzle(sql, { schema });
	migrate(raw, { migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations") });
	const db = raw as unknown as ReturnType<typeof getDb>;
	const now = new Date();
	db.insert(schema.projects)
		.values({ id: "p", name: "Fixture", repoPath: root, createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.worktrees)
		.values({
			id: "wt",
			projectId: "p",
			path: root,
			branch: "test",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	for (const id of ["w", "other"])
		db.insert(schema.workspaces)
			.values({
				id,
				projectId: "p",
				worktreeId: id === "w" ? "wt" : null,
				name: id,
				type: "review",
				prProvider: "github",
				prIdentifier: id === "w" ? "o/r#1" : "o/r#2",
				createdAt: now,
				updatedAt: now,
			})
			.run();
	return {
		db,
		root,
		sql,
		storage: new ReviewPathStorage(db),
		close() {
			sql.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
