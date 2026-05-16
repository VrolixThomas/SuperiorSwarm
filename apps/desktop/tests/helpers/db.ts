import "./../../tests/preload-electron-mock";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb } from "../../src/main/db";
import { projects, workspaces } from "../../src/main/db/schema";

let migrated = false;

export function setupTestDb(): void {
	if (migrated) return;
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations") });
	migrated = true;
}

export function teardownTestDb(): void {
	// Noop — isolation is achieved via nanoid-scoped project IDs
}

export async function seedProject(): Promise<string> {
	const id = `proj-${nanoid(8)}`;
	const now = new Date();
	getDb()
		.insert(projects)
		.values({
			id,
			name: `test-project-${id}`,
			repoPath: `/tmp/test-repo-${nanoid(8)}`,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}

export async function seedWorkspace(
	projectId: string,
	opts: { name: string; isOrchestrator?: boolean; type?: "branch" | "worktree" | "review" }
): Promise<string> {
	const id = `ws-${nanoid(8)}`;
	const now = new Date();
	getDb()
		.insert(workspaces)
		.values({
			id,
			projectId,
			type: opts.type ?? "worktree",
			name: opts.name,
			currentPhase: "idle",
			isOrchestrator: opts.isOrchestrator ?? false,
			sortOrder: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return id;
}
