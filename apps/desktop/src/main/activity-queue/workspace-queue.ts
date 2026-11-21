import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
	ActivityQueueAcknowledgeResult,
	ActivityQueueSource,
	WorkspaceQueueAnswerInput,
	WorkspaceQueueAnswerResult,
	WorkspaceQueueItem,
	WorkspaceQueueLaterInput,
	WorkspaceQueueLaterResult,
	WorkspaceQueueListInput,
	WorkspaceQueueListResult,
	WorkspaceQueueRestoreResult,
	WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import { getDb } from "../db";
import { agentMessages, agentSessions, terminalSessions } from "../db/schema";
import { activityQueueSnoozes, activityQueueSources } from "../db/schema-activity-queue";
import { getDaemonClient } from "../terminal/daemon-instance";
import {
	questionSourceId,
	reconcileAgentSources,
	sessionSourceId,
	workspaceSourceId,
} from "./agent-source";
import { listCurrentActivityQueue } from "./current-items";
import { describeWorkspaceItem } from "./describe-workspace-item";
import { queueEntities } from "./entities";
import { linkedWorkByWorkspace } from "./linked-context";
import { isQuestionAnswer } from "./question-answers";
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
		return (
			(target.type === "workspace" ||
				target.type === "terminal" ||
				target.type === "coordinator") &&
			source.sourceId ===
				workspaceSourceId(target.type === "coordinator" ? target.coordinatorId : target.workspaceId)
		);
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
		(target.type === "workspace" || target.type === "terminal" || target.type === "coordinator") &&
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
	const contexts = new Map([...queueEntities()].map(([id, row]) => [id, row.context]));
	const linkedWork = linkedWorkByWorkspace(
		[...contexts.values()]
			.filter((context) => context.entity?.kind === "workspace")
			.map((context) => context.workspaceId)
	);
	for (const context of contexts.values()) {
		context.linkedWork =
			context.entity?.kind === "workspace" ? (linkedWork.get(context.workspaceId) ?? []) : [];
	}
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
		if (
			target?.type !== "workspace" &&
			target?.type !== "terminal" &&
			target?.type !== "coordinator"
		)
			continue;
		const context = contexts.get(
			target.type === "coordinator" ? target.coordinatorId : target.workspaceId
		);
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
					? {
							provider: target.provider,
							providerSessionId: target.providerSessionId,
							identityCapability: "exact-conversation" as const,
							terminalTitle: terminals.get(target.terminalId)?.title,
						}
					: { identityCapability: "missing-owner" as const }),
			})
		);
		const projected = items[items.length - 1];
		if (projected && source.sourceType === "agent-question") {
			const messageId = (source.snapshot as { messageId: string }).messageId;
			const question = db.select().from(agentMessages).where(eq(agentMessages.id, messageId)).get();
			const answer = db
				.select()
				.from(agentMessages)
				.where(and(eq(agentMessages.inReplyTo, messageId), eq(agentMessages.kind, "answer")))
				.all()
				.find((row) => question && isQuestionAnswer(question, row));
			projected.question = {
				messageId,
				replyCapability:
					target.type === "terminal" && !!target.providerSessionId ? "mcp-inbox" : "unavailable",
				...(target.type !== "terminal"
					? {
							unavailableReason:
								"The sender conversation was not recorded. A reply cannot be delivered safely.",
						}
					: {}),
				...(answer
					? {
							answer: {
								messageId: answer.id,
								content: answer.content,
								delivery: answer.retrievedAt ? ("retrieved" as const) : ("saved" as const),
							},
						}
					: {}),
			};
		}
	}
	return { items, sources, inventory, agentStatusAvailable: current.agentStatusAvailable };
}

/** Group only proven same-conversation task reports and plain turn-end receipts.
 * Raw sources remain separate and retain their distinct lifecycle/receipts.
 */
function groupedItems(
	items: WorkspaceQueueItem[],
	sources: Map<string, ActivityQueueSource>,
	snoozes: ReturnType<typeof currentSnoozes>
) {
	const deferral = (id: string) => {
		const row = snoozes.get(id);
		return JSON.stringify(row ? [row.until, row.untilChange] : null);
	};
	const hidden = new Set<string>();
	const result = items.map((item) => {
		if (sources.get(item.id)?.sourceType !== "agent-workspace" || item.target.type !== "terminal")
			return item;
		const target = item.target;
		const turn = items.find(
			(other) =>
				other.id !== item.id &&
				other.acknowledged === item.acknowledged &&
				deferral(other.id) === deferral(item.id) &&
				sources.get(other.id)?.sourceType === "agent-session" &&
				other.reasons.some((reason) => reason.code === "turn-ended") &&
				other.target.type === "terminal" &&
				other.target.workspaceId === target.workspaceId &&
				other.target.terminalId === target.terminalId &&
				other.target.provider === target.provider &&
				other.target.providerSessionId === target.providerSessionId
		);
		if (!turn) return item;
		hidden.add(turn.id);
		return {
			...item,
			stale: item.stale || turn.stale,
			providerEvidence: [...(item.providerEvidence ?? []), ...(turn.providerEvidence ?? [])],
			ordering: turn.ordering ?? item.ordering,
			missingContext:
				item.evidence.length || turn.evidence.length ? undefined : item.missingContext,
			members: [item, turn].map((member) => ({ id: member.id, revision: member.revision })),
			evidence: [
				...item.evidence,
				...turn.evidence.filter((value) => !item.evidence.includes(value)),
			],
		};
	});
	return result.filter((item) => !hidden.has(item.id));
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
	// Different deferral receipts must remain independent; never hide a pending sibling in Later.
	const pending = groupedItems(current.items, current.sources, snoozes).filter(
		(item) => !item.acknowledged
	);
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
		sourceErrors: items.flatMap((item) =>
			(item.members ?? [{ id: item.id, revision: item.revision }]).flatMap((member) => {
				const source = current.sources.get(member.id);
				return source?.error
					? [{ sourceId: source.sourceId, error: source.error, observedAt: source.observedAt }]
					: [];
			})
		),
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

function validateMembers(
	input: WorkspaceQueueRevisionInput,
	current: Awaited<ReturnType<typeof currentWorkspaceItems>>
) {
	const freshItems = current.items.map((item) => {
		const source = getActivityQueueService().read(item.id);
		return { ...item, acknowledged: source?.acknowledgedRevision === source?.revision };
	});
	const canonical = groupedItems(freshItems, current.sources, currentSnoozes(Date.now())).find(
		(item) => item.id === input.id
	);
	if (!canonical) return null; // A formerly standalone member is now hidden inside a newer group.
	const expected = canonical.members ?? [{ id: input.id, revision: input.revision }];
	const supplied = input.members ?? [{ id: input.id, revision: input.revision }];
	const key = (rows: { id: string; revision: number }[]) =>
		JSON.stringify(rows.map((row) => [row.id, row.revision]).sort());
	if (key(expected) !== key(supplied)) return null;
	if (supplied.some((member) => validateCurrent(member, current).status !== "current")) return null;
	return supplied;
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
		const members = validateMembers(input, current);
		if (!members) return { status: "conflict", item: null };
		for (const member of members)
			if (member.id !== input.id) getActivityQueueService().acknowledge(member);
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
		const members = validateMembers(input, current);
		if (!members) return { status: "conflict" };
		for (const member of members) {
			const snooze = {
				sourceId: member.id,
				revision: member.revision,
				until: input.until ?? null,
				untilChange: input.untilChange,
				createdAt: now,
			};
			db.insert(activityQueueSnoozes)
				.values(snooze)
				.onConflictDoUpdate({ target: activityQueueSnoozes.sourceId, set: snooze })
				.run();
		}
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
		const members = validateMembers(input, current);
		if (
			!members ||
			members.some(
				(member) =>
					!getDb()
						.select()
						.from(activityQueueSnoozes)
						.where(
							and(
								eq(activityQueueSnoozes.sourceId, member.id),
								eq(activityQueueSnoozes.revision, member.revision)
							)
						)
						.get()
			)
		)
			return { status: "conflict" };
		for (const member of members)
			db.delete(activityQueueSnoozes).where(eq(activityQueueSnoozes.sourceId, member.id)).run();
		return { status: "restored" };
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
		const members = validateMembers(input, current);
		if (
			!members ||
			members.some(
				(member) =>
					getActivityQueueService().read(member.id)?.acknowledgedRevision !== member.revision
			)
		)
			return { status: "conflict" };
		for (const member of members)
			db.update(activityQueueSources)
				.set({ acknowledgedRevision: null })
				.where(eq(activityQueueSources.sourceId, member.id))
				.run();
		return { status: "restored" };
	});
}

/** Persist a reply for an exact MCP reader. This never wakes or writes into a PTY. */
export async function workspaceAnswer(
	input: WorkspaceQueueAnswerInput,
	daemon?: Inventory
): Promise<WorkspaceQueueAnswerResult> {
	if (!input.content.trim() || input.content.length > 16000)
		return { status: "unavailable", reason: "Enter an answer of 1 to 16000 characters." };
	const current = await currentWorkspaceItems(daemon);
	return getDb().transaction(() => {
		const checked = validateCurrent(input, current);
		if (checked.status !== "current") return checked;
		if (checked.source.acknowledgedRevision === input.revision) return { status: "conflict" };
		if (
			checked.source.sourceType !== "agent-question" ||
			input.id !== questionSourceId(input.questionId)
		)
			return { status: "conflict" };
		const target = checked.source.candidate?.target;
		if (target?.type !== "terminal" || !target.providerSessionId)
			return { status: "unavailable", reason: "The question has no verified conversation owner." };
		const db = getDb();
		const question = db
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.id, input.questionId))
			.get();
		if (!question || question.fromWorkspaceId !== target.workspaceId) return { status: "conflict" };
		if (
			db
				.select()
				.from(agentMessages)
				.where(eq(agentMessages.inReplyTo, question.id))
				.all()
				.some((answer) => isQuestionAnswer(question, answer))
		)
			return { status: "conflict" };
		const messageId = nanoid();
		db.insert(agentMessages)
			.values({
				id: messageId,
				projectId: question.projectId,
				fromWorkspaceId: null,
				toWorkspaceId: target.workspaceId,
				recipient: target,
				kind: "answer",
				content: input.content.trim(),
				inReplyTo: question.id,
				createdAt: new Date(),
			})
			.run();
		return {
			status: "saved",
			messageId,
			delivery: "saved",
			detail: "Saved for this conversation. The agent has not read or acted on it yet.",
		};
	});
}

/** Reusable action admission. Every grouped member must still be the displayed occurrence. */
export async function currentQueueAction(
	input: WorkspaceQueueRevisionInput,
	daemon?: Inventory
): Promise<WorkspaceQueueItem | null> {
	const current = await currentWorkspaceItems(daemon);
	return getDb().transaction(() => {
		const checked = validateCurrent(input, current);
		if (
			checked.status !== "current" ||
			checked.source.acknowledgedRevision === input.revision ||
			!validateMembers(input, current)
		)
			return null;
		return current.items.find((item) => item.id === input.id) ?? null;
	});
}
