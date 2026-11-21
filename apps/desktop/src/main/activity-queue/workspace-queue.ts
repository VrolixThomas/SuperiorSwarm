import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import type {
	ActivityQueueAcknowledgeResult,
	ActivityQueueSource,
	WorkspaceQueueItem,
	WorkspaceQueueLaterInput,
	WorkspaceQueueLaterResult,
	WorkspaceQueueListInput,
	WorkspaceQueueListResult,
	WorkspaceQueueRestoreResult,
	WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import { getDb } from "../db";
import { agentSessions, projects, terminalSessions, workspaces } from "../db/schema";
import { activityQueueSnoozes, activityQueueSources } from "../db/schema-activity-queue";
import { getDaemonClient } from "../terminal/daemon-instance";
import {
	questionSourceId,
	reconcileAgentSources,
	sessionSourceId,
	workspaceSourceId,
} from "./agent-source";
import { listCurrentActivityQueue } from "./current-items";
import { describeWorkspaceItem, projectTint } from "./describe-workspace-item";
import { getActivityQueueService } from "./service";

const sourceTypes = ["agent-workspace", "agent-question", "agent-session"];
export const MAX_WORKSPACE_SNOOZE_MS = 366 * 24 * 60 * 60 * 1000;
type Inventory = Parameters<typeof listCurrentActivityQueue>[1];

/** Source IDs and target shapes must agree with the owning adapter. */
function isWorkspaceSource(source: ActivityQueueSource): boolean {
	const target = source.candidate?.target;
	if (!target || !["agent-input", "agent-ready"].includes(source.candidate?.kind ?? ""))
		return false;
	if (source.sourceType === "agent-workspace")
		return target.type === "workspace" && source.sourceId === workspaceSourceId(target.workspaceId);
	if (source.sourceType === "agent-session")
		return (
			target.type === "terminal" &&
			source.sourceId ===
				sessionSourceId(
					target.workspaceId,
					target.terminalId,
					target.provider,
					target.providerSessionId
				)
		);
	const snapshot = source.snapshot;
	return (
		source.sourceType === "agent-question" &&
		target.type === "workspace" &&
		!!snapshot &&
		typeof snapshot === "object" &&
		"messageId" in snapshot &&
		typeof snapshot.messageId === "string" &&
		source.sourceId === questionSourceId(snapshot.messageId)
	);
}

async function currentWorkspaceItems(daemon?: Inventory) {
	reconcileAgentSources();
	const inventory = daemon === undefined ? getDaemonClient() : daemon;
	// Reuse the established last-confirmed inventory policy without changing generic list/ack.
	const current = await listCurrentActivityQueue({ includeAcknowledged: true }, inventory);
	// Workspace state may have changed while the inventory request was in flight.
	reconcileAgentSources();
	const db = getDb();
	const sources = new Map(
		db
			.select()
			.from(activityQueueSources)
			.where(inArray(activityQueueSources.sourceType, sourceTypes))
			.all()
			.map((source) => [source.sourceId, source])
	);
	const contexts = new Map(
		db
			.select({ workspace: workspaces, project: projects })
			.from(workspaces)
			.innerJoin(projects, eq(workspaces.projectId, projects.id))
			.all()
			.map(({ workspace, project }) => [
				workspace.id,
				{
					workspaceId: workspace.id,
					workspaceName: workspace.name,
					projectId: project.id,
					projectName: project.name,
					projectColor: project.color,
					projectTint: projectTint(project.id),
				},
			])
	);
	const terminals = new Map(
		db
			.select()
			.from(terminalSessions)
			.all()
			.map((row) => [row.id, row])
	);
	const sessions = new Map(
		db
			.select()
			.from(agentSessions)
			.all()
			.map((row) => [row.terminalId, row])
	);
	const items: WorkspaceQueueItem[] = [];
	for (const item of current.items) {
		const source = sources.get(item.id);
		if (
			!source ||
			source.revision !== item.revision ||
			!isWorkspaceSource(source) ||
			JSON.stringify(source.candidate?.target) !== JSON.stringify(item.target)
		)
			continue;
		const target = source.candidate?.target;
		if (target?.type !== "workspace" && target?.type !== "terminal") continue;
		const context = contexts.get(target.workspaceId);
		if (!context) continue;
		if (target.type === "terminal") {
			const session = sessions.get(target.terminalId);
			if (
				terminals.get(target.terminalId)?.workspaceId !== target.workspaceId ||
				!session ||
				session.workspaceId !== target.workspaceId ||
				session.provider !== target.provider ||
				session.providerSessionId !== target.providerSessionId
			)
				continue;
		}
		items.push(
			describeWorkspaceItem(item, source, {
				...context,
				...(target.type === "terminal"
					? { provider: target.provider, terminalTitle: terminals.get(target.terminalId)?.title }
					: {}),
			})
		);
	}
	return { items, sources, inventory, agentStatusAvailable: current.agentStatusAvailable };
}

/** Expired/obsolete deferrals are local state only; never modify adapter observations. */
function currentSnoozes(now: number) {
	const db = getDb();
	return db.transaction(() => {
		const rows = db
			.select({ snooze: activityQueueSnoozes, source: activityQueueSources })
			.from(activityQueueSnoozes)
			.innerJoin(
				activityQueueSources,
				eq(activityQueueSnoozes.sourceId, activityQueueSources.sourceId)
			)
			.all();
		const active = new Map<string, typeof activityQueueSnoozes.$inferSelect>();
		for (const { snooze, source } of rows) {
			if (
				snooze.revision !== source.revision ||
				!source.candidate ||
				(snooze.until !== null && snooze.until <= now)
			) {
				db.delete(activityQueueSnoozes)
					.where(eq(activityQueueSnoozes.sourceId, snooze.sourceId))
					.run();
			} else active.set(snooze.sourceId, snooze);
		}
		return active;
	});
}

export async function listWorkspaceQueue(
	input: WorkspaceQueueListInput = {},
	daemon?: Inventory,
	now?: number
): Promise<WorkspaceQueueListResult> {
	const current = await currentWorkspaceItems(daemon);
	const snoozes = currentSnoozes(now ?? Date.now());
	const pending = current.items.filter((item) => !item.acknowledged);
	const items = pending
		.filter(
			(item) =>
				(input.view === "later" ? snoozes.has(item.id) : !snoozes.has(item.id)) &&
				(!input.projectId || item.context.projectId === input.projectId)
		)
		.map((item) => {
			const snooze = snoozes.get(item.id);
			return snooze
				? { ...item, snoozed: { until: snooze.until, untilChange: snooze.untilChange } }
				: item;
		});
	const laterCount = pending.filter((item) => snoozes.has(item.id)).length;
	return {
		items,
		totalPending: pending.length - laterCount,
		laterCount,
		agentStatusAvailable: current.agentStatusAvailable,
		updatedAt: current.items.length
			? Math.max(...current.items.map((item) => current.sources.get(item.id)?.observedAt ?? 0))
			: null,
		sourceErrors: items.flatMap((item) => {
			const source = current.sources.get(item.id);
			return source?.error
				? [{ sourceId: source.sourceId, error: source.error, observedAt: source.observedAt }]
				: [];
		}),
	};
}

function validateCurrent(
	input: WorkspaceQueueRevisionInput,
	current: Awaited<ReturnType<typeof currentWorkspaceItems>>
) {
	const source = getActivityQueueService().read(input.id);
	if (!source || !sourceTypes.includes(source.sourceType)) return { status: "not-found" } as const;
	if (source.candidate && !isWorkspaceSource(source)) return { status: "not-found" } as const;
	const item = current.items.find((value) => value.id === input.id);
	if (
		!current.agentStatusAvailable ||
		!current.inventory?.isConnected ||
		!item ||
		source.error ||
		source.revision !== input.revision ||
		item.revision !== input.revision ||
		!source.candidate
	)
		return { status: "conflict" } as const;
	return { status: "current", source } as const;
}

export async function workspaceDone(
	input: WorkspaceQueueRevisionInput,
	daemon?: Inventory
): Promise<ActivityQueueAcknowledgeResult> {
	const current = await currentWorkspaceItems(daemon);
	return getDb().transaction(() => {
		const checked = validateCurrent(input, current);
		if (checked.status === "not-found") return checked;
		if (checked.status === "conflict") return { status: "conflict", item: null };
		return getActivityQueueService().acknowledge(input);
	});
}

export async function later(
	input: WorkspaceQueueLaterInput,
	daemon?: Inventory
): Promise<WorkspaceQueueLaterResult> {
	const now = Date.now();
	if (
		(!input.untilChange && input.until === undefined) ||
		(input.until !== undefined &&
			(!Number.isSafeInteger(input.until) ||
				input.until <= now ||
				input.until > now + MAX_WORKSPACE_SNOOZE_MS))
	)
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Choose a future time within 366 days or Until it changes.",
		});
	const current = await currentWorkspaceItems(daemon);
	const db = getDb();
	return db.transaction(() => {
		const checked = validateCurrent(input, current);
		if (checked.status !== "current") return checked;
		// Done can change the receipt without changing the source revision while inventory is awaited.
		if (
			checked.source.acknowledgedRevision === input.revision ||
			(input.until !== undefined && input.until <= Date.now())
		)
			return { status: "conflict" };
		const snooze = {
			sourceId: input.id,
			revision: input.revision,
			until: input.until ?? null,
			untilChange: input.untilChange,
			createdAt: now,
		};
		db.insert(activityQueueSnoozes)
			.values(snooze)
			.onConflictDoUpdate({ target: activityQueueSnoozes.sourceId, set: snooze })
			.run();
		return { status: "snoozed" };
	});
}

export async function bringBack(
	input: WorkspaceQueueRevisionInput,
	daemon?: Inventory
): Promise<WorkspaceQueueRestoreResult> {
	const current = await currentWorkspaceItems(daemon);
	const db = getDb();
	return db.transaction(() => {
		const checked = validateCurrent(input, current);
		if (checked.status !== "current") return checked;
		const deleted = db
			.delete(activityQueueSnoozes)
			.where(
				and(
					eq(activityQueueSnoozes.sourceId, input.id),
					eq(activityQueueSnoozes.revision, input.revision)
				)
			)
			.run();
		return { status: deleted.changes ? "restored" : "conflict" };
	});
}

export async function undoDone(
	input: WorkspaceQueueRevisionInput,
	daemon?: Inventory
): Promise<WorkspaceQueueRestoreResult> {
	const current = await currentWorkspaceItems(daemon);
	const db = getDb();
	return db.transaction(() => {
		const checked = validateCurrent(input, current);
		if (checked.status !== "current") return checked;
		const restored = db
			.update(activityQueueSources)
			.set({ acknowledgedRevision: null })
			.where(
				and(
					eq(activityQueueSources.sourceId, input.id),
					eq(activityQueueSources.revision, input.revision),
					eq(activityQueueSources.acknowledgedRevision, input.revision)
				)
			)
			.run();
		return { status: restored.changes ? "restored" : "conflict" };
	});
}
