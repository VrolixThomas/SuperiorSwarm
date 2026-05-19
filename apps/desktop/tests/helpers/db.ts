import "./../../tests/preload-electron-mock";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { nanoid } from "nanoid";
import { getDb } from "../../src/main/db";
import {
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	projects,
	workspaces,
} from "../../src/main/db/schema";

let migrated = false;

export function setupTestDb(): void {
	if (migrated) return;
	const db = getDb();
	migrate(db, { migrationsFolder: join(import.meta.dir, "../../src/main/db/migrations") });
	migrated = true;
}

export function teardownTestDb(): void {
	// Most tables use nanoid-scoped IDs for isolation; cross_repo_orchestrators
	// supports a list-all query in CRUD tests, so we clean it up explicitly.
	// FK cascade takes care of cross_repo_orchestrator_projects rows.
	getDb().run(`DELETE FROM cross_repo_orchestrators`);
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

export async function seedCrossRepoOrchestrator(opts: {
	name?: string;
	workDir?: string;
	agentKind?: string;
	projectIds?: string[];
}): Promise<string> {
	const id = `xro-${nanoid(8)}`;
	const now = new Date();
	getDb()
		.insert(crossRepoOrchestrators)
		.values({
			id,
			name: opts.name ?? `xro-test-${id}`,
			workDir: opts.workDir ?? `/tmp/xro-${id}`,
			agentKind: opts.agentKind ?? "claude",
			status: "idle",
			sortOrder: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	if (opts.projectIds) {
		for (let i = 0; i < opts.projectIds.length; i++) {
			getDb()
				.insert(crossRepoOrchestratorProjects)
				.values({
					orchestratorId: id,
					projectId: opts.projectIds[i]!,
					sortOrder: i,
					createdAt: now,
				})
				.run();
		}
	}
	return id;
}
