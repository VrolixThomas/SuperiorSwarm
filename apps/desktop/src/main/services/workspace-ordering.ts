import { and, count, eq, inArray } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "../../shared/control-plane";
import { getDb } from "../db";
import { orchestratorMembers, workspaces } from "../db/schema";

export async function reorderTopLevel(input: {
	projectId: string;
	orderedIds: string[];
}): Promise<{ ok: true }> {
	const db = getDb();

	// Enforce completeness: orderedIds must cover every workspace in the project
	const [{ total }] = db
		.select({ total: count() })
		.from(workspaces)
		.where(eq(workspaces.projectId, input.projectId))
		.all();
	if (total !== input.orderedIds.length) {
		throw new Error("reorderTopLevel: orderedIds must contain every workspace in the project");
	}

	// Validate each submitted id
	const found = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.projectId, input.projectId), inArray(workspaces.id, input.orderedIds)))
		.all();
	if (found.length !== input.orderedIds.length) {
		const foundIds = new Set(found.map((r) => r.id));
		for (const id of input.orderedIds) {
			if (!foundIds.has(id)) {
				// Check if the id exists in a different project
				const elsewhere = db
					.select({ id: workspaces.id })
					.from(workspaces)
					.where(eq(workspaces.id, id))
					.all();
				if (elsewhere.length > 0) {
					throw new ForbiddenError("cross-project reorderTopLevel");
				}
				throw new NotFoundError(id);
			}
		}
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

	// Enforce completeness: orderedIds must cover every member of the orchestrator
	const [{ total }] = db
		.select({ total: count() })
		.from(orchestratorMembers)
		.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
		.all();
	if (total !== input.orderedIds.length) {
		throw new Error("reorderChildren: orderedIds must contain every member of the orchestrator");
	}

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
		const foundIds = new Set(found.map((r) => r.workspaceId));
		const missingId = input.orderedIds.find((id) => !foundIds.has(id));
		throw new NotFoundError(missingId!);
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
