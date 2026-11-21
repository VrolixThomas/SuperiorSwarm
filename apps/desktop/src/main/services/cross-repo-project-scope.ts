import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { crossRepoOrchestratorProjects, type crossRepoOrchestrators, projects } from "../db/schema";

export type CrossRepoAccessScope = typeof crossRepoOrchestrators.$inferSelect.accessScope;

/** Shared by authorization and display. All-project scope is live inventory, never cached links. */
export function crossRepoProjects(orchestratorId: string, accessScope: CrossRepoAccessScope) {
	const db = getDb();
	const fields = {
		id: projects.id,
		name: projects.name,
		kind: projects.kind,
		path: projects.repoPath,
	};
	if (accessScope === "all")
		return db.select(fields).from(projects).orderBy(asc(projects.id)).all();
	return db
		.select(fields)
		.from(crossRepoOrchestratorProjects)
		.innerJoin(projects, eq(crossRepoOrchestratorProjects.projectId, projects.id))
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, orchestratorId))
		.orderBy(asc(crossRepoOrchestratorProjects.sortOrder), asc(projects.id))
		.all();
}

export function crossRepoProjectIds(orchestratorId: string, accessScope: CrossRepoAccessScope) {
	return crossRepoProjects(orchestratorId, accessScope).map((project) => project.id);
}
