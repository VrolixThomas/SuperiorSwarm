import { eq } from "drizzle-orm";
import type { QueueEntity, WorkspaceQueueItem } from "../../shared/activity-queue";
import { getDb } from "../db";
import { crossRepoOrchestrators, projects, workspaces } from "../db/schema";
import { crossRepoProjects } from "../services/cross-repo-project-scope";
import { projectTint } from "./describe-workspace-item";

/** One authoritative entity lookup; coordinators are never surrogate workspaces. */
export function queueEntities() {
	const db = getDb();
	const rows = db
		.select({ workspace: workspaces, project: projects })
		.from(workspaces)
		.innerJoin(projects, eq(workspaces.projectId, projects.id))
		.all();
	const result = rows.map(({ workspace, project }) => ({
		id: workspace.id,
		name: workspace.name,
		currentPhase: workspace.currentPhase as string,
		needs: workspace.needs,
		statusText: workspace.statusText,
		statusUpdatedAt: workspace.statusUpdatedAt,
		updatedAt: workspace.updatedAt,
		projectId: project.id as string | undefined,
		projectName: project.name as string | undefined,
		entity: { kind: "workspace", id: workspace.id } as QueueEntity,
		context: {
			entity: { kind: "workspace", id: workspace.id },
			workspaceId: workspace.id,
			workspaceName: workspace.name,
			projectId: project.id,
			projectName: project.name,
			projectColor: project.color,
			projectTint: projectTint(project.id),
			projectKind: project.kind,
			projectPath: project.repoPath,
			role: workspace.isOrchestrator ? "orchestrator" : "workspace",
		} as WorkspaceQueueItem["context"],
	}));
	for (const row of db.select().from(crossRepoOrchestrators).all()) {
		if (rows.some((value) => value.workspace.id === row.id)) {
			const index = result.findIndex((value) => value.id === row.id);
			if (index >= 0) result.splice(index, 1);
			continue; // Ambiguous historical IDs cannot prove either owner.
		}
		if (row.kind === "external") continue;
		result.push({
			id: row.id,
			name: row.name,
			currentPhase: row.status,
			needs: row.needs,
			statusText: row.statusText,
			statusUpdatedAt: row.statusUpdatedAt,
			updatedAt: row.updatedAt,
			projectId: undefined,
			projectName: undefined,
			entity: { kind: "coordinator", id: row.id },
			context: {
				entity: { kind: "coordinator", id: row.id },
				workspaceId: row.id,
				workspaceName: row.name,
				projectName: "Cross-repository coordinator",
				linkedProjects: crossRepoProjects(row.id, row.accessScope),
				projectPath: row.workDir,
				projectTint: projectTint(row.id),
				role: "coordinator",
			},
		});
	}
	return new Map(result.map((row) => [row.id, row]));
}
