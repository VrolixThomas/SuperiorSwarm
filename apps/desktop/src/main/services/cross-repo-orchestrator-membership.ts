import { and, asc, eq, inArray, max } from "drizzle-orm";
import { ForbiddenError, NotFoundError, type WorkspacePhase } from "../../shared/control-plane";
import { invalidateCrossRepoLinksCache } from "../control-plane/orchestrator-event-sink";
import { getDb } from "../db";
import {
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	orchestratorMembers,
	workspaces,
	worktrees,
} from "../db/schema";

export async function attachToCrossRepoOrchestrator(input: {
	orchestratorId: string;
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const xro = db
		.select({ id: crossRepoOrchestrators.id })
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.orchestratorId))
		.get();
	if (!xro) throw new NotFoundError(input.orchestratorId);

	const ws = db
		.select({ projectId: workspaces.projectId, isOrchestrator: workspaces.isOrchestrator })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);
	if (ws.isOrchestrator) {
		throw new Error("cannot attach an orchestrator workspace as a cross-repo member");
	}

	const link = db
		.select({ projectId: crossRepoOrchestratorProjects.projectId })
		.from(crossRepoOrchestratorProjects)
		.where(
			and(
				eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId),
				eq(crossRepoOrchestratorProjects.projectId, ws.projectId)
			)
		)
		.get();
	if (!link) {
		throw new ForbiddenError("workspace's project is not linked to this cross-repo orchestrator");
	}

	db.transaction((tx) => {
		// Single-parent: remove any existing membership (per-repo or cross-repo)
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
				parentKind: "cross_repo",
				sortOrder: nextSort,
				createdAt: new Date(),
			})
			.run();
	});

	return { ok: true };
}

export async function detachFromCrossRepoOrchestrator(input: {
	workspaceId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const ws = db
		.select({ projectId: workspaces.projectId })
		.from(workspaces)
		.where(eq(workspaces.id, input.workspaceId))
		.get();
	if (!ws) throw new NotFoundError(input.workspaceId);

	db.transaction((tx) => {
		const deleted = tx
			.delete(orchestratorMembers)
			.where(
				and(
					eq(orchestratorMembers.workspaceId, input.workspaceId),
					eq(orchestratorMembers.parentKind, "cross_repo")
				)
			)
			.run();
		if (deleted.changes === 0) return;

		const maxRow = tx
			.select({ m: max(workspaces.sortOrder) })
			.from(workspaces)
			.where(eq(workspaces.projectId, ws.projectId))
			.get();
		const nextSort = (maxRow?.m ?? -1) + 1;

		tx.update(workspaces)
			.set({ sortOrder: nextSort, updatedAt: new Date() })
			.where(eq(workspaces.id, input.workspaceId))
			.run();
	});

	return { ok: true };
}

export async function listCrossRepoMembers(input: {
	orchestratorId: string;
}): Promise<
	Array<{
		workspaceId: string;
		sortOrder: number;
		parentKind: string;
		projectId: string;
		workspaceName: string;
		currentPhase: WorkspacePhase;
		statusText: string | null;
		needs: string | null;
		statusUpdatedAt: Date | null;
		worktreePath: string | null;
	}>
> {
	const db = getDb();
	return db
		.select({
			workspaceId: orchestratorMembers.workspaceId,
			sortOrder: orchestratorMembers.sortOrder,
			parentKind: orchestratorMembers.parentKind,
			projectId: workspaces.projectId,
			workspaceName: workspaces.name,
			currentPhase: workspaces.currentPhase,
			statusText: workspaces.statusText,
			needs: workspaces.needs,
			statusUpdatedAt: workspaces.statusUpdatedAt,
			worktreePath: worktrees.path,
		})
		.from(orchestratorMembers)
		.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
		.leftJoin(worktrees, eq(worktrees.id, workspaces.worktreeId))
		.where(
			and(
				eq(orchestratorMembers.orchestratorId, input.orchestratorId),
				eq(orchestratorMembers.parentKind, "cross_repo")
			)
		)
		.orderBy(asc(orchestratorMembers.sortOrder))
		.all();
}

export async function addProjectToCrossRepoOrchestrator(input: {
	orchestratorId: string;
	projectId: string;
}): Promise<{ ok: true }> {
	const db = getDb();

	const xro = db
		.select({ id: crossRepoOrchestrators.id })
		.from(crossRepoOrchestrators)
		.where(eq(crossRepoOrchestrators.id, input.orchestratorId))
		.get();
	if (!xro) throw new NotFoundError(input.orchestratorId);

	const maxRow = db
		.select({ m: max(crossRepoOrchestratorProjects.sortOrder) })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId))
		.get();
	const nextSort = (maxRow?.m ?? -1) + 1;

	db.insert(crossRepoOrchestratorProjects)
		.values({
			orchestratorId: input.orchestratorId,
			projectId: input.projectId,
			sortOrder: nextSort,
			createdAt: new Date(),
		})
		.onConflictDoNothing()
		.run();

	invalidateCrossRepoLinksCache(input.projectId);

	return { ok: true };
}

export async function removeProjectFromCrossRepoOrchestrator(input: {
	orchestratorId: string;
	projectId: string;
}): Promise<{ detachedCount: number }> {
	const db = getDb();
	let detachedCount = 0;

	db.transaction((tx) => {
		// Find all member workspaces whose projectId is the one being removed
		const victims = tx
			.select({ workspaceId: orchestratorMembers.workspaceId })
			.from(orchestratorMembers)
			.innerJoin(workspaces, eq(workspaces.id, orchestratorMembers.workspaceId))
			.where(
				and(
					eq(orchestratorMembers.orchestratorId, input.orchestratorId),
					eq(orchestratorMembers.parentKind, "cross_repo"),
					eq(workspaces.projectId, input.projectId)
				)
			)
			.all();
		detachedCount = victims.length;

		if (victims.length > 0) {
			tx.delete(orchestratorMembers)
				.where(
					and(
						eq(orchestratorMembers.orchestratorId, input.orchestratorId),
						eq(orchestratorMembers.parentKind, "cross_repo"),
						inArray(
							orchestratorMembers.workspaceId,
							victims.map((v) => v.workspaceId)
						)
					)
				)
				.run();
		}

		tx.delete(crossRepoOrchestratorProjects)
			.where(
				and(
					eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId),
					eq(crossRepoOrchestratorProjects.projectId, input.projectId)
				)
			)
			.run();
	});

	invalidateCrossRepoLinksCache(input.projectId);

	return { detachedCount };
}

export async function listLinkedProjects(input: {
	orchestratorId: string;
}): Promise<string[]> {
	const db = getDb();
	return db
		.select({ projectId: crossRepoOrchestratorProjects.projectId })
		.from(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, input.orchestratorId))
		.orderBy(asc(crossRepoOrchestratorProjects.sortOrder))
		.all()
		.map((r) => r.projectId);
}
