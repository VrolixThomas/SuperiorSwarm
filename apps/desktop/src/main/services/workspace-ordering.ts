import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { orchestratorMembers, workspaces } from "../db/schema";

export async function reorderTopLevel(input: {
	projectId: string;
	orderedIds: string[];
}): Promise<{ ok: true }> {
	const db = getDb();
	const found = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.projectId, input.projectId), inArray(workspaces.id, input.orderedIds)))
		.all();
	if (found.length !== input.orderedIds.length) {
		throw new Error("reorderTopLevel: unknown or cross-project workspace id");
	}
	const now = new Date();
	db.transaction((tx) => {
		input.orderedIds.forEach((id, i) => {
			tx.update(workspaces)
				.set({ sortOrder: i, updatedAt: now })
				.where(eq(workspaces.id, id))
				.run();
		});
	});
	return { ok: true };
}

export async function reorderChildren(input: {
	orchestratorId: string;
	orderedIds: string[];
}): Promise<{ ok: true }> {
	const db = getDb();
	const found = db
		.select({ workspaceId: orchestratorMembers.workspaceId })
		.from(orchestratorMembers)
		.where(
			and(
				eq(orchestratorMembers.orchestratorId, input.orchestratorId),
				inArray(orchestratorMembers.workspaceId, input.orderedIds)
			)
		)
		.all();
	if (found.length !== input.orderedIds.length) {
		throw new Error("reorderChildren: unknown member workspace id");
	}
	db.transaction((tx) => {
		input.orderedIds.forEach((id, i) => {
			tx.update(orchestratorMembers)
				.set({ sortOrder: i })
				.where(
					and(
						eq(orchestratorMembers.orchestratorId, input.orchestratorId),
						eq(orchestratorMembers.workspaceId, id)
					)
				)
				.run();
		});
	});
	return { ok: true };
}
