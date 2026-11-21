import { eq } from "drizzle-orm";
import type { WorkspaceQueueItem } from "../../shared/activity-queue";
import type { AgentEvent } from "../../shared/agent-events";
import type {
	QueuePermissionDecisionInput,
	QueuePermissionDecisionResult,
} from "../../shared/queue-permissions";
import type { AgentEventSnapshot } from "../activity-queue/agent-event-order";
import { sessionSourceId, workspaceReporter } from "../activity-queue/agent-source";
import { getActivityQueueService } from "../activity-queue/service";
import { listWorkspaceQueue } from "../activity-queue/workspace-queue";
import { getDb } from "../db";
import { agentSessions, terminalSessions } from "../db/schema";
import { onPermissionTerminalVisibility, permissionTerminalHidden } from "./permission-visibility";
import { type PermissionTarget, QueuePermissions } from "./queue-permissions";

function snapshot(target: PermissionTarget) {
	return getActivityQueueService().read(
		sessionSourceId(
			target.workspaceId,
			target.terminalId,
			target.provider,
			target.providerSessionId
		)
	)?.snapshot as AgentEventSnapshot | undefined;
}
function currentGeneration(target: PermissionTarget): string | null {
	if (!permissionTerminalHidden(target.terminalId)) return null;
	const session = getDb()
		.select()
		.from(agentSessions)
		.where(eq(agentSessions.terminalId, target.terminalId))
		.get();
	const terminal = getDb()
		.select()
		.from(terminalSessions)
		.where(eq(terminalSessions.id, target.terminalId))
		.get();
	const source = snapshot(target);
	if (
		!session ||
		terminal?.workspaceId !== target.workspaceId ||
		session.workspaceId !== target.workspaceId ||
		session.entityKind !== target.entity?.kind ||
		target.entity.id !== target.workspaceId ||
		session.provider !== target.provider ||
		session.providerSessionId !== target.providerSessionId ||
		session.state !== "needs-input" ||
		source?.permission?.outcome !== "pending" ||
		source.continuation !== "none"
	)
		return null;
	return JSON.stringify([session.createdAt.getTime(), source.turnId, source.permission.requestId]);
}
export const queuePermissions = new QueuePermissions({ currentGeneration });
onPermissionTerminalVisibility((terminalId, visible) => {
	if (visible !== false) queuePermissions.invalidate(terminalId);
});
export function resolvePermissionEvent(event: AgentEvent) {
	const target = workspaceReporter(event.workspaceId, event.terminalId);
	if (
		!target ||
		target.provider !== event.agent ||
		target.providerSessionId !== event.providerSessionId ||
		snapshot(target)?.permission?.requestId !== event.permission?.requestId
	)
		return null;
	const generation = currentGeneration(target);
	return generation ? { target, generation } : null;
}
export const getQueuePermissionCapability = (item: WorkspaceQueueItem) =>
	queuePermissions.capability(item);
export async function decideQueuePermission(
	input: QueuePermissionDecisionInput
): Promise<QueuePermissionDecisionResult> {
	const list = await listWorkspaceQueue({ view: "pending" });
	if (!list.agentStatusAvailable)
		return {
			status: "unavailable",
			detail:
				"Current terminal inventory is unavailable. Open the conversation to review its native prompt.",
		};
	return queuePermissions.decide(input, list.items.find((item) => item.id === input.id) ?? null);
}
