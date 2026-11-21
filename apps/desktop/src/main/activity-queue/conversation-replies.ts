import { createHash } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type {
	WorkspaceQueueItem,
	WorkspaceQueueReplyCapability,
	WorkspaceQueueReplyInput,
	WorkspaceQueueReplyResult,
	WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import { hasUnsafeTerminalText } from "../../shared/terminal-files";
import { getDb } from "../db";
import { agentSessions } from "../db/schema";
import { activityQueueDeliveries } from "../db/schema-activity-queue";
import { getDaemonClient } from "../terminal/daemon-instance";
import { currentQueueAction } from "./workspace-queue";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const members = (input: WorkspaceQueueRevisionInput) =>
	[...(input.members ?? [{ id: input.id, revision: input.revision }])].sort((a, b) =>
		a.id.localeCompare(b.id)
	);
function problem(item: WorkspaceQueueItem): string | null {
	const t = item.target;
	if (t.type !== "terminal" || !t.entity || !t.providerSessionId)
		return "This item has no verified exact conversation. Open it to continue.";
	if (item.question || item.permission || !["agent-done", "agent-failed"].includes(item.situation))
		return "Only a completed or failed chat can receive a direct reply. Open this conversation.";
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
		return "Safe atomic resume is unavailable for this terminal service. Open this exact conversation to resume it; no reply was sent.";
	if (
		!["idle", "error"].includes(session.state) &&
		!(session.state === "needs-input" && item.situation === "agent-failed")
	)
		return "The conversation is busy or awaiting input. Open it before continuing.";
	if (!getDaemonClient()?.supportsQueueReply)
		return "This terminal service does not support safe Queue replies. Open the conversation.";
	return null;
}
export async function workspaceReplyCapability(
	input: WorkspaceQueueRevisionInput
): Promise<WorkspaceQueueReplyCapability> {
	const item = await currentQueueAction(input);
	if (!item)
		return {
			status: "unavailable",
			reason: "This queue occurrence changed or its terminal is unavailable. Refresh the queue.",
		};
	const reason = problem(item);
	if (reason) return { status: "unavailable", reason };
	const t = item.target;
	if (t.type !== "terminal") return { status: "unavailable", reason: "Conversation unavailable." };
	const lease = await getDaemonClient()?.queueReplyTarget(
		t.terminalId,
		t.provider,
		t.providerSessionId!,
		false
	);
	if (!lease?.supported)
		return {
			status: "unavailable",
			reason: "The foreground provider could not be verified. Open the conversation.",
		};
	return {
		status: "available",
		mode: "reply",
		detail: "Send to this exact chat. Terminal admission does not confirm model receipt or action.",
	};
}
function receipt(row: typeof activityQueueDeliveries.$inferSelect): WorkspaceQueueReplyResult {
	if (row.state === "rejected")
		return {
			status: "rejected",
			reason: "No reply was admitted. Open the conversation to check its state.",
		};
	return {
		status: row.state === "admitted" ? "admitted" : "uncertain",
		requestId: row.requestId,
		detail:
			row.state === "admitted"
				? "Submitted to this exact provider terminal. Model receipt and action are not confirmed."
				: "Delivery is uncertain. Do not resend; open this conversation to check. This request will not be submitted again.",
	};
}
export async function workspaceReply(
	input: WorkspaceQueueReplyInput
): Promise<WorkspaceQueueReplyResult> {
	if (
		!input.requestId ||
		input.requestId.length > 128 ||
		!input.content.trim() ||
		Buffer.byteLength(input.content) > 16000 ||
		hasUnsafeTerminalText(input.content.replaceAll("\n", ""))
	)
		return {
			status: "rejected",
			reason: "Enter up to 16000 bytes without terminal control characters.",
		};
	const db = getDb();
	const fingerprint = hash(input.content);
	const wanted = members(input);
	const occurrenceKey = hash(JSON.stringify(wanted));
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
	const reason = problem(item);
	if (reason) return { status: "unavailable", reason };
	const target = item.target;
	if (target.type !== "terminal")
		return { status: "unavailable", reason: "Exact conversation unavailable." };
	const daemon = getDaemonClient();
	const lease = await daemon?.queueReplyTarget(
		target.terminalId,
		target.provider,
		target.providerSessionId!
	);
	if (!lease?.supported || !daemon)
		return {
			status: "unavailable",
			reason: "The provider foreground is unverified. Open the conversation.",
		};
	item = await currentQueueAction(input);
	if (!item || problem(item) || JSON.stringify(item.target) !== JSON.stringify(target))
		return { status: "conflict", reason: "The conversation changed during admission." };
	const row = {
		requestId: input.requestId,
		occurrenceKey,
		fingerprint,
		target,
		members: wanted,
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
		result = await daemon.submitQueueReply(
			target.terminalId,
			lease.generation,
			input.requestId,
			input.content
		);
	} catch {}
	// The daemon is authoritative when it committed a receipt before a response was lost.
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
