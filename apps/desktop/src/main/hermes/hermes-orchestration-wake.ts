import { and, eq } from "drizzle-orm";
import type {
	CoordinationEvent,
	CoordinationEventMetadata,
	EventBus,
} from "../control-plane/event-bus";
import { getDb } from "../db";
import {
	hermesConnections,
	hermesSessionAdmissions,
	hermesSessionWorkspaces,
	orchestratorMembers,
} from "../db/schema";

export interface HermesOrchestrationWakeTarget {
	connectionId: string;
	managerId: string;
	profileId: string;
	lineageRootId: string;
}

export interface HermesOrchestrationWakeService {
	enqueue(input: HermesOrchestrationWakeTarget & { eventId: string; text: string }): Promise<void>;
}

export function actionableHermesOrchestrationWorkspaceId(event: CoordinationEvent): string | null {
	if (event.event === "status") {
		return event.phase === "blocked" || event.phase === "done" ? event.workspaceId : null;
	}
	return event.from || null;
}

export function formatHermesOrchestrationWake(
	event: CoordinationEvent,
	metadata: CoordinationEventMetadata
): string {
	if (event.event === "status") {
		return [
			"[SuperiorSwarm child update]",
			`event_id: ${metadata.eventId}`,
			`workspace_id: ${event.workspaceId}`,
			`phase: ${event.phase}`,
			event.statusText ? `status: ${event.statusText.slice(0, 2_000)}` : null,
			event.needs ? `needs: ${event.needs.slice(0, 2_000)}` : null,
			"Review this owned child now. Use get_workspace/get_agent_output as needed, then resume_agent if follow-up is required.",
		]
			.filter((line): line is string => Boolean(line))
			.join("\n");
	}
	return [
		"[SuperiorSwarm child message]",
		`event_id: ${metadata.eventId}`,
		`workspace_id: ${event.from}`,
		`kind: ${event.kind}`,
		`message: ${event.content.slice(0, 6_000)}`,
		"Review this owned child message and respond through SuperiorSwarm if action is required.",
	].join("\n");
}

export function resolveHermesOrchestrationWakeTargets(
	workspaceId: string
): HermesOrchestrationWakeTarget[] {
	const db = getDb();
	const links = db
		.select({
			connectionId: hermesSessionWorkspaces.connectionId,
			profileId: hermesSessionWorkspaces.profileId,
			hermesSessionId: hermesSessionWorkspaces.hermesSessionId,
			hermesLineageRootId: hermesSessionWorkspaces.hermesLineageRootId,
		})
		.from(hermesSessionWorkspaces)
		.where(eq(hermesSessionWorkspaces.workspaceId, workspaceId))
		.all();
	const targets = new Map<string, HermesOrchestrationWakeTarget>();
	for (const link of links) {
		const connection = db
			.select({ managerId: hermesConnections.managerId })
			.from(hermesConnections)
			.where(eq(hermesConnections.id, link.connectionId))
			.get();
		if (!connection?.managerId) continue;
		const membership = db
			.select({ workspaceId: orchestratorMembers.workspaceId })
			.from(orchestratorMembers)
			.where(
				and(
					eq(orchestratorMembers.orchestratorId, connection.managerId),
					eq(orchestratorMembers.parentKind, "cross_repo"),
					eq(orchestratorMembers.workspaceId, workspaceId)
				)
			)
			.get();
		if (!membership) continue;
		const lineageRootId = link.hermesLineageRootId ?? link.hermesSessionId;
		const admission = db
			.select({ durableSessionId: hermesSessionAdmissions.durableSessionId })
			.from(hermesSessionAdmissions)
			.where(
				and(
					eq(hermesSessionAdmissions.managerId, connection.managerId),
					eq(hermesSessionAdmissions.profileId, link.profileId),
					eq(hermesSessionAdmissions.durableSessionId, lineageRootId)
				)
			)
			.get();
		if (!admission) continue;
		const target = {
			connectionId: link.connectionId,
			managerId: connection.managerId,
			profileId: link.profileId,
			lineageRootId,
		};
		targets.set(JSON.stringify(Object.values(target)), target);
	}
	return [...targets.values()];
}

export function attachHermesOrchestrationWake(
	bus: EventBus,
	service: HermesOrchestrationWakeService
): () => void {
	return bus.subscribeAll((_projectId, event, metadata) => {
		const workspaceId = actionableHermesOrchestrationWorkspaceId(event);
		if (!workspaceId) return;
		const text = formatHermesOrchestrationWake(event, metadata);
		for (const target of resolveHermesOrchestrationWakeTargets(workspaceId)) {
			void service.enqueue({ ...target, eventId: metadata.eventId, text }).catch((error) => {
				console.warn("[hermes-orchestration-wake] enqueue failed:", error);
			});
		}
	});
}
