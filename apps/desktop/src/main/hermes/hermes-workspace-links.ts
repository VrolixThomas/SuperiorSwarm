import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { HermesLinkedWorkspace, HermesWorkspaceArtifact } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesSessionWorkspaces, projects, workspaces, worktrees } from "../db/schema";

export interface LinkHermesWorkspaceInput {
	connectionId: string;
	profileId: string;
	hermesSessionId: string;
	hermesLineageRootId?: string | null;
	workspaceId: string;
	source: "tool-artifact" | "manual";
}

function linkId(
	input: Pick<
		LinkHermesWorkspaceInput,
		"connectionId" | "profileId" | "hermesSessionId" | "workspaceId"
	>
) {
	return `hermes-link-${createHash("sha256")
		.update(
			`${input.connectionId}\0${input.profileId}\0${input.hermesSessionId}\0${input.workspaceId}`
		)
		.digest("hex")
		.slice(0, 24)}`;
}

export function linkHermesWorkspace(input: LinkHermesWorkspaceInput) {
	const db = getDb();
	const existing = db
		.select()
		.from(hermesSessionWorkspaces)
		.where(
			and(
				eq(hermesSessionWorkspaces.connectionId, input.connectionId),
				eq(hermesSessionWorkspaces.profileId, input.profileId),
				eq(hermesSessionWorkspaces.hermesSessionId, input.hermesSessionId),
				eq(hermesSessionWorkspaces.workspaceId, input.workspaceId)
			)
		)
		.get();
	const id = existing?.id ?? linkId(input);
	const linkedAt = existing?.linkedAt ?? new Date();
	const source = existing?.source === "tool-artifact" ? "tool-artifact" : input.source;
	db.insert(hermesSessionWorkspaces)
		.values({
			id,
			connectionId: input.connectionId,
			profileId: input.profileId,
			hermesSessionId: input.hermesSessionId,
			hermesLineageRootId: input.hermesLineageRootId ?? existing?.hermesLineageRootId ?? null,
			workspaceId: input.workspaceId,
			source,
			linkedAt,
		})
		.onConflictDoUpdate({
			target: [
				hermesSessionWorkspaces.connectionId,
				hermesSessionWorkspaces.profileId,
				hermesSessionWorkspaces.hermesSessionId,
				hermesSessionWorkspaces.workspaceId,
			],
			set: {
				hermesLineageRootId: input.hermesLineageRootId ?? existing?.hermesLineageRootId ?? null,
				source,
			},
		})
		.run();
	const linked = db
		.select()
		.from(hermesSessionWorkspaces)
		.where(
			and(
				eq(hermesSessionWorkspaces.id, id),
				eq(hermesSessionWorkspaces.profileId, input.profileId)
			)
		)
		.get();
	if (!linked) throw new Error("Hermes workspace link could not be saved");
	return linked;
}

export function linkHermesWorkspaceArtifacts(input: {
	connectionId: string;
	profileId: string;
	hermesSessionId: string;
	hermesLineageRootId?: string | null;
	artifacts: HermesWorkspaceArtifact[];
}): HermesLinkedWorkspace[] {
	const db = getDb();
	for (const artifact of input.artifacts) {
		const workspace = db
			.select({
				id: workspaces.id,
				projectId: workspaces.projectId,
				branch: worktrees.branch,
				path: worktrees.path,
			})
			.from(workspaces)
			.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
			.where(eq(workspaces.id, artifact.workspaceId))
			.get();
		if (
			!workspace ||
			workspace.projectId !== artifact.projectId ||
			workspace.branch !== artifact.branch ||
			workspace.path !== artifact.worktreePath
		) {
			continue;
		}
		linkHermesWorkspace({
			connectionId: input.connectionId,
			profileId: input.profileId,
			hermesSessionId: input.hermesSessionId,
			hermesLineageRootId: input.hermesLineageRootId,
			workspaceId: artifact.workspaceId,
			source: "tool-artifact",
		});
	}
	return listHermesWorkspaceLinks(input.connectionId, input.profileId, input.hermesSessionId);
}

export function canonicalizeHermesWorkspaceLinks(
	connectionId: string,
	profileId: string,
	aliasSessionIds: string[],
	canonicalSessionId: string
): void {
	const aliases = [...new Set(aliasSessionIds)].filter(
		(sessionId) => sessionId && sessionId !== canonicalSessionId
	);
	if (aliases.length === 0) return;
	getDb().transaction((tx) => {
		for (const aliasSessionId of aliases) {
			const aliasRows = tx
				.select()
				.from(hermesSessionWorkspaces)
				.where(
					and(
						eq(hermesSessionWorkspaces.connectionId, connectionId),
						eq(hermesSessionWorkspaces.profileId, profileId),
						eq(hermesSessionWorkspaces.hermesSessionId, aliasSessionId)
					)
				)
				.all();
			for (const aliasRow of aliasRows) {
				const canonicalRow = tx
					.select()
					.from(hermesSessionWorkspaces)
					.where(
						and(
							eq(hermesSessionWorkspaces.connectionId, connectionId),
							eq(hermesSessionWorkspaces.profileId, profileId),
							eq(hermesSessionWorkspaces.hermesSessionId, canonicalSessionId),
							eq(hermesSessionWorkspaces.workspaceId, aliasRow.workspaceId)
						)
					)
					.get();
				tx.delete(hermesSessionWorkspaces)
					.where(
						and(
							eq(hermesSessionWorkspaces.id, aliasRow.id),
							eq(hermesSessionWorkspaces.profileId, profileId)
						)
					)
					.run();
				if (canonicalRow) {
					tx.update(hermesSessionWorkspaces)
						.set({
							hermesLineageRootId: canonicalSessionId,
							source:
								canonicalRow.source === "tool-artifact" || aliasRow.source === "tool-artifact"
									? "tool-artifact"
									: "manual",
							linkedAt:
								canonicalRow.linkedAt.getTime() <= aliasRow.linkedAt.getTime()
									? canonicalRow.linkedAt
									: aliasRow.linkedAt,
						})
						.where(
							and(
								eq(hermesSessionWorkspaces.id, canonicalRow.id),
								eq(hermesSessionWorkspaces.profileId, profileId)
							)
						)
						.run();
					continue;
				}
				tx.insert(hermesSessionWorkspaces)
					.values({
						id: linkId({
							connectionId,
							profileId,
							hermesSessionId: canonicalSessionId,
							workspaceId: aliasRow.workspaceId,
						}),
						connectionId,
						profileId,
						hermesSessionId: canonicalSessionId,
						hermesLineageRootId: canonicalSessionId,
						workspaceId: aliasRow.workspaceId,
						source: aliasRow.source,
						linkedAt: aliasRow.linkedAt,
					})
					.run();
			}
		}
	});
}

export function unlinkHermesWorkspace(
	connectionId: string,
	profileId: string,
	hermesSessionId: string,
	workspaceId: string
): void {
	getDb()
		.delete(hermesSessionWorkspaces)
		.where(
			and(
				eq(hermesSessionWorkspaces.connectionId, connectionId),
				eq(hermesSessionWorkspaces.profileId, profileId),
				eq(hermesSessionWorkspaces.hermesSessionId, hermesSessionId),
				eq(hermesSessionWorkspaces.workspaceId, workspaceId)
			)
		)
		.run();
}

export function deleteHermesSessionWorkspaceLinks(
	connectionId: string,
	profileId: string,
	hermesSessionId: string
): void {
	getDb()
		.delete(hermesSessionWorkspaces)
		.where(
			and(
				eq(hermesSessionWorkspaces.connectionId, connectionId),
				eq(hermesSessionWorkspaces.profileId, profileId),
				eq(hermesSessionWorkspaces.hermesSessionId, hermesSessionId)
			)
		)
		.run();
}

export function listHermesWorkspaceLinks(
	connectionId: string,
	profileId: string,
	hermesSessionId: string
): HermesLinkedWorkspace[] {
	const rows = getDb()
		.select({
			id: hermesSessionWorkspaces.id,
			connectionId: hermesSessionWorkspaces.connectionId,
			profileId: hermesSessionWorkspaces.profileId,
			hermesSessionId: hermesSessionWorkspaces.hermesSessionId,
			hermesLineageRootId: hermesSessionWorkspaces.hermesLineageRootId,
			workspaceId: hermesSessionWorkspaces.workspaceId,
			source: hermesSessionWorkspaces.source,
			linkedAt: hermesSessionWorkspaces.linkedAt,
			resolvedWorkspaceId: workspaces.id,
			workspaceName: workspaces.name,
			currentPhase: workspaces.currentPhase,
			statusText: workspaces.statusText,
			needs: workspaces.needs,
			statusUpdatedAt: workspaces.statusUpdatedAt,
			terminalId: workspaces.terminalId,
			projectId: projects.id,
			projectName: projects.name,
			branch: worktrees.branch,
			worktreePath: worktrees.path,
		})
		.from(hermesSessionWorkspaces)
		.leftJoin(workspaces, eq(hermesSessionWorkspaces.workspaceId, workspaces.id))
		.leftJoin(projects, eq(workspaces.projectId, projects.id))
		.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
		.where(
			and(
				eq(hermesSessionWorkspaces.connectionId, connectionId),
				eq(hermesSessionWorkspaces.profileId, profileId),
				eq(hermesSessionWorkspaces.hermesSessionId, hermesSessionId)
			)
		)
		.all();
	return rows.map((row) => ({
		id: row.id,
		connectionId: row.connectionId,
		profileId: row.profileId,
		hermesSessionId: row.hermesSessionId,
		hermesLineageRootId: row.hermesLineageRootId,
		workspaceId: row.workspaceId,
		source: row.source,
		linkedAt: row.linkedAt.getTime(),
		missing: row.resolvedWorkspaceId === null,
		projectId: row.projectId,
		projectName: row.projectName,
		workspaceName: row.workspaceName,
		branch: row.branch,
		worktreePath: row.worktreePath,
		currentPhase: row.currentPhase,
		statusText: row.statusText,
		needs: row.needs,
		statusUpdatedAt: row.statusUpdatedAt?.getTime() ?? null,
		hasTerminal: row.terminalId !== null,
	}));
}
