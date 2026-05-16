import { asc, eq, max } from "drizzle-orm";
import { ForbiddenError, NotFoundError } from "../../shared/control-plane";
import { getDb } from "../db";
import { orchestratorMembers, workspaces } from "../db/schema";

export async function attachToOrchestrator(input: {
	orchestratorId: string;
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const orch = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.orchestratorId))
		.get();
	if (!orch) throw new NotFoundError(input.orchestratorId);
	if (!orch.isOrchestrator) {
		throw new Error(`workspace ${input.orchestratorId} is not an orchestrator`);
	}

	const child = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!child) throw new NotFoundError(input.workspaceId);
	if (child.projectId !== orch.projectId) {
		throw new ForbiddenError("attachToOrchestrator: cross-project disallowed");
	}
	if (child.isOrchestrator) {
		throw new Error("cannot nest orchestrator under another orchestrator");
	}

	db.transaction((tx) => {
		// V1 single-parent: remove any existing membership for this workspace
		tx.delete(orchestratorMembers)
			.where(eq(orchestratorMembers.workspaceId, input.workspaceId))
			.run();

		const maxRow = tx
			.select({ m: max(orchestratorMembers.sortOrder) })
			.from(orchestratorMembers)
			.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
			.get();
		const nextSort = (maxRow?.m ?? -1) + 1;

		tx.insert(orchestratorMembers)
			.values({
				orchestratorId: input.orchestratorId,
				workspaceId: input.workspaceId,
				sortOrder: nextSort,
				createdAt: new Date(),
			})
			.run();
	});

	return { ok: true };
}

export async function detachFromOrchestrator(input: {
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const child = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!child) throw new NotFoundError(input.workspaceId);

	db.transaction((tx) => {
		tx.delete(orchestratorMembers)
			.where(eq(orchestratorMembers.workspaceId, input.workspaceId))
			.run();

		const maxRow = tx
			.select({ m: max(workspaces.sortOrder) })
			.from(workspaces)
			.where(eq(workspaces.projectId, child.projectId))
			.get();
		const nextSort = (maxRow?.m ?? -1) + 1;

		tx.update(workspaces)
			.set({ sortOrder: nextSort, updatedAt: new Date() })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	});

	return { ok: true };
}

export async function listMembership(input: {
	orchestratorId: string;
}): Promise<Array<{ workspaceId: string; sortOrder: number }>> {
	const db = getDb();
	return db
		.select({
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
		})
		.from(orchestratorMembers)
		.where(eq(orchestratorMembers.orchestratorId, input.orchestratorId))
		.orderBy(asc(orchestratorMembers.sortOrder))
		.all();
}
