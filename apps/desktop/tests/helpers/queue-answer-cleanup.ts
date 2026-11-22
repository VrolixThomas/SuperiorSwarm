import { eq, inArray, sql } from "drizzle-orm";
import { questionSourceId, workspaceSourceId } from "../../src/main/activity-queue/agent-source";
import { getDb } from "../../src/main/db";
import {
	activityQueueDeliveries,
	activityQueueSources,
	agentMessages,
	agentSessions,
	crossRepoOrchestrators,
	projects,
	terminalSessions,
	workspaces,
} from "../../src/main/db/schema";
const owned = new Map<string, string>();
export function ownAnswerFixture(projectId: string, entityId: string) {
	owned.set(entityId, projectId);
}
/** Remove only this fixture's records; leave other test modules' setup intact. */
export function cleanupAnswerFixtures() {
	const db = getDb();
	for (const [entityId, projectId] of owned) {
		const questions = new Set(
			db
				.select({ id: agentMessages.id })
				.from(agentMessages)
				.where(eq(agentMessages.projectId, projectId))
				.all()
				.map((row) => questionSourceId(row.id))
		);
		const sourceIds = db
			.select({ id: activityQueueSources.sourceId, type: activityQueueSources.sourceType })
			.from(activityQueueSources)
			.all()
			.filter((row) => {
				if (row.id === workspaceSourceId(entityId) || questions.has(row.id)) return true;
				if (row.type !== "agent-session") return false;
				try {
					const key: unknown = JSON.parse(row.id);
					return Array.isArray(key) && key[0] === "agent-session" && key[1] === entityId;
				} catch {
					return false;
				}
			})
			.map((row) => row.id);
		if (sourceIds.length)
			db.delete(activityQueueSources)
				.where(inArray(activityQueueSources.sourceId, sourceIds))
				.run();
		db.delete(activityQueueDeliveries)
			.where(
				sql`json_extract(CASE WHEN json_valid(${activityQueueDeliveries.target}) THEN ${activityQueueDeliveries.target} ELSE NULL END, '$.workspaceId') = ${entityId}`
			)
			.run();
		db.delete(agentSessions).where(eq(agentSessions.workspaceId, entityId)).run();
		db.delete(terminalSessions).where(eq(terminalSessions.workspaceId, entityId)).run();
		db.delete(crossRepoOrchestrators).where(eq(crossRepoOrchestrators.id, entityId)).run();
		db.delete(workspaces).where(eq(workspaces.id, entityId)).run();
		db.delete(projects).where(eq(projects.id, projectId)).run();
	}
	owned.clear();
}
