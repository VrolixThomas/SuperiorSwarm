import { eq } from "drizzle-orm";
import {
	canonicalWorkspaceDirectory,
	getWorkspaceCwdOrThrow,
} from "../agent-launch/workspace-cwd-lookup";
import { getDb } from "../db";
import { projects, workspaces } from "../db/schema";

/** Review snapshots use the shared repository's objects, independent of agent checkout lifecycle. */
export function getReviewSnapshotRoot(workspaceId: string): string {
	const db = getDb();
	const workspace = db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).get();
	if (workspace?.type !== "review") return getWorkspaceCwdOrThrow(workspaceId);
	const project = db.select().from(projects).where(eq(projects.id, workspace.projectId)).get();
	if (!project || project.kind === "folder") throw new Error("Review repository is unavailable");
	return canonicalWorkspaceDirectory(project.repoPath);
}
