import { eq } from "drizzle-orm";
import { getDb } from "../../db";
import { projects } from "../../db/schema";

export async function resolvePath(projectId: string, cwd?: string): Promise<string> {
	if (cwd) return cwd;
	const db = getDb();
	const project = await db.query.projects.findFirst({
		where: eq(projects.id, projectId),
	});
	if (!project) throw new Error("Project not found");
	return project.repoPath;
}
