import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type {
	ActivityQueueItem,
	ExternalQueueItem,
	QueueViewListResult,
	WorkspaceQueueLaterInput,
	WorkspaceQueueListInput,
	WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import { getDb } from "../db";
import { activityQueueSnoozes, activityQueueSources } from "../db/schema-activity-queue";
import { getProjectHookQueueErrors } from "./hook-source";
import { getActivityQueueService } from "./service";
import {
	MAX_WORKSPACE_SNOOZE_MS,
	bringBack,
	later,
	listWorkspaceQueue,
	undoDone,
	workspaceDone,
} from "./workspace-queue";

type Adapter = {
	describe: (item: ActivityQueueItem) => ExternalQueueItem | null;
	current?: (item: ActivityQueueItem) => boolean;
};
const adapters = new Map<string, Adapter>();
/** Runtime adapters register only their owned kinds. Workspace guards remain unchanged. */
export function registerExternalQueueAdapter(kinds: string[], adapter: Adapter) {
	for (const kind of kinds) adapters.set(kind, adapter);
	return () => {
		for (const kind of kinds) if (adapters.get(kind) === adapter) adapters.delete(kind);
	};
}
export function describeExternalQueueItem(item: ActivityQueueItem) {
	const adapter = adapters.get(item.kind);
	return adapter && (!adapter.current || adapter.current(item)) ? adapter.describe(item) : null;
}
function externalItems(includeAcknowledged = false) {
	return getActivityQueueService()
		.list({ includeAcknowledged })
		.items.flatMap((item) => {
			const described = describeExternalQueueItem(item);
			return described ? [described] : [];
		});
}
export async function listQueueView(
	input: WorkspaceQueueListInput = {}
): Promise<QueueViewListResult> {
	const workspace = await listWorkspaceQueue(input);
	const now = Date.now();
	const sources = getActivityQueueService();
	const snoozes = new Map(
		getDb()
			.select()
			.from(activityQueueSnoozes)
			.all()
			.filter((row) => {
				const source = sources.read(row.sourceId);
				return (
					source?.revision === row.revision &&
					source.candidate &&
					(row.until === null || row.until > now)
				);
			})
			.map((row) => [row.sourceId, row])
	);
	const all = externalItems();
	const deferred = all.filter((item) => snoozes.has(item.id));
	const items = all
		.filter(
			(item) =>
				(input.view === "later" ? snoozes.has(item.id) : !snoozes.has(item.id)) &&
				(!input.projectId || item.projectId === input.projectId)
		)
		.map((item) => {
			const snooze = snoozes.get(item.id);
			return snooze
				? { ...item, snoozed: { until: snooze.until, untilChange: snooze.untilChange } }
				: item;
		});
	return {
		...workspace,
		items: [
			...workspace.items.map((item) =>
				workspace.agentStatusAvailable === false ? { ...item, stale: true } : item
			),
			...items,
		],
		totalPending: workspace.totalPending + all.length - deferred.length,
		laterCount: workspace.laterCount + deferred.length,
		sourceErrors: [
			...workspace.sourceErrors,
			...getProjectHookQueueErrors(),
			...items.flatMap((item) => {
				const source = sources.read(item.id);
				return source?.error
					? [{ sourceId: item.id, error: source.error, observedAt: source.observedAt }]
					: [];
			}),
		],
	};
}
/** Exact admission shared by local and delayed external actions. No daemon dependency. */
export function currentExternalQueueItem(
	input: WorkspaceQueueRevisionInput,
	includeAcknowledged = false
): ExternalQueueItem | null {
	if (input.members?.length) return null;
	return (
		externalItems(includeAcknowledged).find(
			(item) => item.id === input.id && item.revision === input.revision && !item.stale
		) ?? null
	);
}
function isExternal(id: string) {
	const source = getActivityQueueService().read(id);
	return source?.candidate && adapters.has(source.candidate.kind);
}
export async function queueViewDone(input: WorkspaceQueueRevisionInput) {
	if (!isExternal(input.id)) return workspaceDone(input);
	return currentExternalQueueItem(input)
		? getActivityQueueService().acknowledge(input)
		: { status: "conflict" as const, item: null };
}
export async function queueViewLater(input: WorkspaceQueueLaterInput) {
	if (!isExternal(input.id)) return later(input);
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
	return getDb().transaction(() => {
		if (!currentExternalQueueItem(input)) return { status: "conflict" as const };
		const row = {
			sourceId: input.id,
			revision: input.revision,
			until: input.until ?? null,
			untilChange: input.untilChange,
			createdAt: now,
		};
		getDb()
			.insert(activityQueueSnoozes)
			.values(row)
			.onConflictDoUpdate({ target: activityQueueSnoozes.sourceId, set: row })
			.run();
		return { status: "snoozed" as const };
	});
}
export async function queueViewBringBack(input: WorkspaceQueueRevisionInput) {
	if (!isExternal(input.id)) return bringBack(input);
	return getDb().transaction(() => {
		if (!currentExternalQueueItem(input)) return { status: "conflict" as const };
		const changed = getDb()
			.delete(activityQueueSnoozes)
			.where(
				and(
					eq(activityQueueSnoozes.sourceId, input.id),
					eq(activityQueueSnoozes.revision, input.revision)
				)
			)
			.run();
		return { status: changed.changes ? ("restored" as const) : ("conflict" as const) };
	});
}
export async function queueViewUndoDone(input: WorkspaceQueueRevisionInput) {
	if (!isExternal(input.id)) return undoDone(input);
	return getDb().transaction(() => {
		const item = currentExternalQueueItem(input, true);
		if (!item?.acknowledged) return { status: "conflict" as const };
		getDb()
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
		return { status: "restored" as const };
	});
}
