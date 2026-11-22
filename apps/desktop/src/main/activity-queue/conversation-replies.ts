import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import {
	QUEUE_REPLY_MAX_CHARACTERS,
	type WorkspaceQueueItem,
	type WorkspaceQueueReplyCapability,
	type WorkspaceQueueReplyInput,
	type WorkspaceQueueReplyResult,
	type WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import { MAX_FRAME_BYTES } from "../../shared/daemon-protocol";
import {
	type QueueAnswerBinding,
	answerContinuationFits,
	answerContinuationPrompt,
} from "../../shared/queue-answer-continuation";
import { queueOwnerKey } from "../../shared/queue-resume";
import { hasUnsafeTerminalText } from "../../shared/terminal-files";
import { getDb } from "../db";
import { agentMessages, agentSessions } from "../db/schema";
import { activityQueueDeliveries } from "../db/schema-activity-queue";
import { getDaemonClient } from "../terminal/daemon-instance";
import { isAnswerContinuation } from "./question-answers";
import { currentQueueAction, listWorkspaceQueue } from "./workspace-queue";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const members = (input: WorkspaceQueueRevisionInput) =>
	[...(input.members ?? [{ id: input.id, revision: input.revision }])].sort((a, b) =>
		a.id.localeCompare(b.id)
	);
function problem(item: WorkspaceQueueItem, questionId?: string): string | null {
	const t = item.target;
	if (t.type !== "terminal" || !t.entity || !t.providerSessionId)
		return "This item has no verified exact conversation. Open it to continue.";
	if (
		item.permission ||
		(questionId
			? item.question?.messageId !== questionId
			: item.question || !["agent-done", "agent-failed"].includes(item.situation))
	)
		return "This conversation needs a different action. Open it before continuing.";
	if (questionId && !getDaemonClient()?.supportsQueueAnswer)
		return "Open this chat to continue. Saved-answer continuation is unavailable in this terminal.";
	const session = getDb()
		.select()
		.from(agentSessions)
		.where(eq(agentSessions.terminalId, t.terminalId))
		.get();
	if (
		!session ||
		session.workspaceId !== t.workspaceId ||
		session.provider !== t.provider ||
		session.providerSessionId !== t.providerSessionId ||
		session.entityKind !== t.entity.kind
	)
		return "The conversation was replaced. Refresh the queue.";
	if (session.state === "hibernated")
		return getDaemonClient()?.supportsQueueResume
			? null
			: "Open this sleeping chat to continue; this terminal cannot safely resume it from Queue.";
	if (
		!["idle", "error"].includes(session.state) &&
		!(session.state === "needs-input" && item.situation === "agent-failed")
	)
		return "The conversation is busy or awaiting input. Open it before continuing.";
	if (!getDaemonClient()?.supportsQueueReply)
		return "Reply here is unavailable for this terminal. Open the chat to continue.";
	return null;
}
function mode(item: WorkspaceQueueItem): "live" | "resume" {
	return item.target.type === "terminal" &&
		getDb()
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.terminalId, item.target.terminalId))
			.get()?.state === "hibernated"
		? "resume"
		: "live";
}
async function lease(item: WorkspaceQueueItem, reserve: boolean) {
	const t = item.target;
	const daemon = getDaemonClient();
	if (t.type !== "terminal" || !t.providerSessionId || !daemon) return null;
	try {
		return mode(item) === "resume"
			? daemon.queueResumeTarget(t.terminalId, t.provider, t.providerSessionId, reserve)
			: daemon.queueReplyTarget(t.terminalId, t.provider, t.providerSessionId, reserve);
	} catch {
		return null;
	}
}
export async function workspaceContinuationCapability(
	input: WorkspaceQueueRevisionInput,
	questionId?: string
): Promise<WorkspaceQueueReplyCapability> {
	const item = await currentQueueAction(input);
	if (!item)
		return {
			status: "unavailable",
			reason: "This occurrence changed or its terminal is unavailable. Refresh the queue.",
		};
	const reason = problem(item, questionId);
	if (reason) return { status: "unavailable", reason };
	if (questionId && !(await admissionMembers(item, { questionId })))
		return {
			status: "unavailable",
			reason:
				"Another question or permission needs attention before this conversation can continue.",
		};
	const target = await lease(item, false);
	if (!target?.supported)
		return {
			status: "unavailable",
			reason:
				mode(item) === "resume"
					? "Open this chat to resume it. Its original launch settings or empty terminal could not be verified."
					: "Open this chat and complete a turn before replying here.",
		};
	return {
		status: "available",
		mode: mode(item) === "resume" ? "resume" : "reply",
		detail:
			mode(item) === "resume"
				? "Resume this same conversation with its original launch settings and send your message."
				: "Send to this exact chat. The agent must still accept and act on your reply.",
	};
}
export const workspaceReplyCapability = (input: WorkspaceQueueRevisionInput) =>
	workspaceContinuationCapability(input);
function receipt(row: typeof activityQueueDeliveries.$inferSelect): WorkspaceQueueReplyResult {
	if (row.continuationTurnId)
		return {
			status: "received",
			requestId: row.requestId,
			detail:
				"This chat accepted a matching prompt. This does not confirm the requested work is complete.",
		};
	if (row.state === "rejected")
		return {
			status: "rejected",
			reason: "The reply was not sent. Check the chat, then try again.",
		};
	return {
		status: row.state === "admitted" ? "admitted" : "uncertain",
		requestId: row.requestId,
		detail:
			row.state === "admitted"
				? "Submitted to this chat. The agent has not confirmed receiving or acting on it."
				: "Delivery is uncertain. Do not resend; open this conversation to check. This request will not be submitted again.",
	};
}
function answerValid(
	item: WorkspaceQueueItem,
	binding: QueueAnswerBinding,
	content: string
): boolean {
	if (item.target.type !== "terminal" || item.question?.messageId !== binding.questionId)
		return false;
	const db = getDb();
	const question = db
		.select()
		.from(agentMessages)
		.where(eq(agentMessages.id, binding.questionId))
		.get();
	const answer = db
		.select()
		.from(agentMessages)
		.where(eq(agentMessages.id, binding.answerId))
		.get();
	return (
		!!question &&
		!!answer &&
		!answer.retrievedAt &&
		isAnswerContinuation(question, answer, item.target) &&
		answerContinuationPrompt(binding, answer.content) === content &&
		answerContinuationFits(content)
	);
}
async function admissionMembers(
	item: WorkspaceQueueItem,
	binding?: Pick<QueueAnswerBinding, "questionId">
) {
	if (!binding) return members(item);
	const all = [
		...(await listWorkspaceQueue()).items,
		...(await listWorkspaceQueue({ view: "later" })).items,
	];
	if (item.target.type !== "terminal") return null;
	const key = queueOwnerKey(item.target);
	const same = all.filter((i) => i.target.type === "terminal" && queueOwnerKey(i.target) === key);
	if (
		same.some(
			(i) => i.permission || (i.question && i.question.messageId !== binding.questionId) || i.stale
		)
	)
		return null;
	const receipts = new Map<string, { id: string; revision: number }>();
	for (const i of same) for (const receipt of members(i)) receipts.set(receipt.id, receipt);
	if (!receipts.has(item.id) || receipts.size > 10) return null;
	return [...receipts.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export async function submitWorkspaceContinuation(
	input: WorkspaceQueueReplyInput,
	binding?: QueueAnswerBinding
): Promise<WorkspaceQueueReplyResult> {
	const content = binding ? input.content : input.content.trim();
	if (
		!input.requestId ||
		input.requestId.length > 128 ||
		!content.trim() ||
		hasUnsafeTerminalText(content.replaceAll("\n", "")) ||
		(binding
			? !answerContinuationFits(content)
			: content.length > QUEUE_REPLY_MAX_CHARACTERS ||
				Buffer.byteLength(content) > 16000 ||
				/^[!/]/.test(content))
	)
		return {
			status: "rejected",
			reason: "Enter up to 4,000 characters without terminal controls or provider commands.",
		};
	const db = getDb();
	const fingerprint = hash(content);
	const occurrenceKey = hash(JSON.stringify(members(input)));
	const previous = db
		.select()
		.from(activityQueueDeliveries)
		.where(eq(activityQueueDeliveries.requestId, input.requestId))
		.get();
	if (previous)
		return previous.fingerprint === fingerprint && previous.occurrenceKey === occurrenceKey
			? receipt(previous)
			: { status: "conflict", reason: "This request ID already belongs to a different reply." };
	if (
		db
			.select()
			.from(activityQueueDeliveries)
			.where(
				and(
					eq(activityQueueDeliveries.occurrenceKey, occurrenceKey),
					ne(activityQueueDeliveries.state, "rejected")
				)
			)
			.get()
	)
		return {
			status: "conflict",
			reason:
				"A reply already has a delivery receipt for this occurrence. Open the conversation before continuing.",
		};
	let item = await currentQueueAction(input);
	if (!item)
		return { status: "conflict", reason: "This occurrence changed. Refresh before replying." };
	let reason = problem(item, binding?.questionId);
	if (reason) return { status: "unavailable", reason };
	if (binding && !answerValid(item, binding, content))
		return {
			status: "rejected",
			reason: "This saved answer changed or was already retrieved. Refresh the question.",
		};
	const target = item.target;
	if (target.type !== "terminal")
		return { status: "unavailable", reason: "Exact conversation unavailable." };
	const intendedMode = mode(item);
	const captured = await admissionMembers(item, binding);
	if (!captured)
		return {
			status: "unavailable",
			reason:
				"Another question or permission needs attention before this conversation can continue.",
		};
	const token = await lease(item, true);
	const daemon = getDaemonClient();
	if (!token?.supported || !daemon)
		return {
			status: "unavailable",
			reason:
				"Open this conversation to continue. Its current input or launch settings could not be verified.",
		};
	item = await currentQueueAction(input);
	reason = item ? problem(item, binding?.questionId) : "changed";
	if (
		!item ||
		reason ||
		mode(item) !== intendedMode ||
		JSON.stringify(item.target) !== JSON.stringify(target) ||
		(binding && !answerValid(item, binding, content))
	)
		return {
			status: "conflict",
			reason: "The conversation or saved answer changed during admission.",
		};
	const currentMembers = await admissionMembers(item, binding);
	if (JSON.stringify(currentMembers) !== JSON.stringify(captured))
		return {
			status: "conflict",
			reason: "The conversation's pending updates changed. Refresh before continuing.",
		};
	if (
		Buffer.byteLength(
			JSON.stringify({
				type: intendedMode === "resume" ? "queue-resume-input" : "queue-input",
				id: target.terminalId,
				generation: token.generation,
				deliveryId: input.requestId,
				content,
				requestId: "00000000-0000-0000-0000-000000000000",
			})
		) +
			1 >
		MAX_FRAME_BYTES
	)
		return {
			status: "rejected",
			reason: "This saved answer is too large to continue automatically. Open the chat.",
		};
	const row = {
		requestId: input.requestId,
		continuationTurnId: null,
		cleanupProtectedTurnId: null,
		occurrenceKey,
		fingerprint,
		target,
		members: captured,
		mode: intendedMode,
		answerBinding: binding ?? null,
		state: "reserved" as const,
		createdAt: Date.now(),
	};
	const inserted = db.insert(activityQueueDeliveries).values(row).onConflictDoNothing().run();
	if (!inserted.changes) {
		const existing = db
			.select()
			.from(activityQueueDeliveries)
			.where(eq(activityQueueDeliveries.requestId, input.requestId))
			.get();
		return existing &&
			existing.fingerprint === fingerprint &&
			existing.occurrenceKey === occurrenceKey
			? receipt(existing)
			: {
					status: "conflict",
					reason:
						"A reply was already submitted for this occurrence. Open the conversation to check.",
				};
	}
	let result: "admitted" | "rejected" | "uncertain" = "uncertain";
	try {
		result =
			intendedMode === "resume"
				? await daemon.submitQueueResume(
						target.terminalId,
						token.generation,
						input.requestId,
						content
					)
				: await daemon.submitQueueReply(
						target.terminalId,
						token.generation,
						input.requestId,
						content
					);
	} catch {}
	const persisted = db
		.select()
		.from(activityQueueDeliveries)
		.where(eq(activityQueueDeliveries.requestId, input.requestId))
		.get();
	if (persisted && persisted.state !== "reserved") return receipt(persisted);
	db.update(activityQueueDeliveries)
		.set({ state: result })
		.where(eq(activityQueueDeliveries.requestId, input.requestId))
		.run();
	return receipt({ ...row, state: result });
}
export const workspaceReply = (input: WorkspaceQueueReplyInput) =>
	submitWorkspaceContinuation(input);
/** Read-only receipt recovery never submits an intent. */
export function workspaceReplyReceipt(requestId: string): WorkspaceQueueReplyResult | null {
	const row = getDb()
		.select()
		.from(activityQueueDeliveries)
		.where(eq(activityQueueDeliveries.requestId, requestId))
		.get();
	return row ? receipt(row) : null;
}
