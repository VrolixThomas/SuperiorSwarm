import type {
	HermesActiveTurnSnapshot,
	HermesAttachmentKind,
	HermesAttachmentMetadata,
	HermesOriginProjection,
	HermesQueuedFollowUpSummary,
	HermesRuntimeEvent,
	HermesSessionHistory,
	HermesSessionHistoryPage,
	HermesSessionRevision,
	HermesSessionSummary,
	HermesSubagentEventPayload,
	HermesTranscriptMessage,
} from "../../shared/hermes";
import {
	HERMES_ATTACHMENT_CONTEXT_END,
	HERMES_ATTACHMENT_CONTEXT_START,
	HERMES_ATTACHMENT_IPC_MAX_BYTES,
	HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
	HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
	HERMES_MAX_ATTACHMENTS,
	HERMES_PDF_ATTACHMENT_MAX_BYTES,
	hermesSessionIdentityKey,
	isHermesLoopbackUrl,
	isSafeHermesFileReference,
} from "../../shared/hermes";

export type HermesSessionFilter = "open" | "all" | "archived";

export interface HermesInteractionChoice {
	value: string;
	label: string;
}

export interface HermesPendingInteraction {
	requestId: string;
	prompt: string;
	choices: HermesInteractionChoice[];
}

export interface HermesLiveTool {
	id: string;
	turnId: string | null;
	name: string;
	status: "running" | "complete" | "failed";
}

export interface HermesLiveSubagent extends HermesSubagentEventPayload {
	latestText: string | null;
	currentTool: string | null;
	updatedAt: number;
}

export interface HermesLiveState {
	running: boolean;
	runtimeStatus: string | null;
	streamingText: string;
	completed: Array<{ turnId: string | null; text: string; canonicalMessageIds: string[] }>;
	activeTurnCanonicalAssistantIds: string[];
	tools: HermesLiveTool[];
	pendingApproval: HermesPendingInteraction | null;
	pendingClarification: HermesPendingInteraction | null;
	queuedFollowUps: HermesQueuedFollowUpSummary[];
	followUpSnapshotReceived: boolean;
	subagents: HermesLiveSubagent[];
	historyRefreshRequired: boolean;
	error: string | null;
}

const FAILED_TRANSCRIPT_STATUSES = new Set(["cancelled", "error", "failed", "interrupted"]);

const RUNNING_TRANSCRIPT_STATUSES = new Set([
	"busy",
	"queued",
	"running",
	"streaming",
	"submitting",
	"working",
]);

export const HERMES_CHAT_OVERFLOW_CLASSES = {
	ancestor: "min-w-0 overflow-hidden",
	transcriptOwner: "min-h-0 min-w-0 overflow-x-hidden overflow-y-auto",
	arbitraryContent: "min-w-0 break-words [overflow-wrap:anywhere]",
	technicalDetail: "max-h-64 min-w-0 overflow-x-auto overflow-y-auto",
} as const;

export const HERMES_CHAT_LAYOUT_CLASSES = {
	gutter: "px-4 md:px-6 lg:px-12 2xl:px-16",
	frame: "w-full min-w-0 max-w-none",
	assistantColumn: "mr-auto w-full min-w-0 max-w-[66ch]",
	activityColumn: "mr-auto w-full min-w-0 max-w-[66ch]",
	composerColumn: "mx-auto w-full min-w-0 max-w-[800px]",
	userBubble: "ml-auto w-fit max-w-[min(640px,76%)]",
} as const;

export type HermesHistorySyncDecision = "none" | "tail" | "full";

export const HERMES_HISTORY_CANONICAL_FALLBACK_INTERVAL_MS = 15_000;
const HERMES_HISTORY_REVISION_FAILURE_THRESHOLD = 3;

export function decideHermesHistorySync(
	previous: HermesSessionRevision | null,
	next: HermesSessionRevision
): HermesHistorySyncDecision {
	if (!next.latestMessageIdIsStable) return "full";
	if (!previous || previous.durableSessionId !== next.durableSessionId) return "tail";
	if (
		previous.latestMessageId === next.latestMessageId &&
		previous.latestMessageAt === next.latestMessageAt
	) {
		return "none";
	}
	if (next.latestMessageId === null) {
		return previous.latestMessageId === null ? "none" : "full";
	}
	if (previous.latestMessageId === null) return "tail";
	if (
		previous.latestMessageAt !== null &&
		next.latestMessageAt !== null &&
		next.latestMessageAt < previous.latestMessageAt
	) {
		return "full";
	}
	return "tail";
}

export function mergeHermesHistoryTail(
	current: HermesSessionHistory,
	tail: HermesSessionHistoryPage
): HermesSessionHistory {
	if (current.durableSessionId !== tail.durableSessionId) return current;
	if (canReplaceHermesHistoryFromTail(current, tail)) {
		return {
			durableSessionId: tail.durableSessionId,
			view: tail.view,
			messageIdsAreStable: tail.messageIdsAreStable,
			messages: tail.messages,
		};
	}
	const continuation = hermesHistoryTailContinuation(current, tail);
	if (!continuation) return current;
	return {
		...current,
		view: current.view === "durable" || tail.view === "durable" ? "durable" : "active",
		messages: continuation,
	};
}

export function canMergeHermesHistoryTail(
	current: HermesSessionHistory,
	tail: HermesSessionHistoryPage
): boolean {
	if (current.durableSessionId !== tail.durableSessionId) return false;
	if (canReplaceHermesHistoryFromTail(current, tail)) return true;
	return hermesHistoryTailContinuation(current, tail) !== null;
}

export function applyHermesHistoryTail(
	current: HermesSessionHistory,
	tail: HermesSessionHistoryPage
): HermesSessionHistory | null {
	return canMergeHermesHistoryTail(current, tail) ? mergeHermesHistoryTail(current, tail) : null;
}

export class HermesHistorySyncCoordinator {
	private selectionKey: string | null = null;
	private checkpoint: HermesSessionRevision | null = null;
	private lastCanonicalRefreshAt: number | null = null;
	private consecutiveRevisionFailures = 0;
	private lastRevisionErrorUpdatedAt: number | null = null;

	decide(selectionKey: string, revision: HermesSessionRevision): HermesHistorySyncDecision {
		this.select(selectionKey);
		this.consecutiveRevisionFailures = 0;
		this.lastRevisionErrorUpdatedAt = null;
		return decideHermesHistorySync(this.checkpoint, revision);
	}

	applyTail(
		selectionKey: string,
		revision: HermesSessionRevision,
		current: HermesSessionHistory,
		tail: HermesSessionHistoryPage
	): HermesSessionHistory | null {
		this.select(selectionKey);
		if (
			revision.durableSessionId !== current.durableSessionId ||
			revision.durableSessionId !== tail.durableSessionId
		) {
			return null;
		}
		if (!hermesHistoryContainsRevision(tail, revision)) return null;
		const synchronized = applyHermesHistoryTail(current, tail);
		if (!synchronized) return null;
		this.checkpoint = revision;
		return synchronized;
	}

	acceptCanonical(
		selectionKey: string,
		revision: HermesSessionRevision,
		history: HermesSessionHistory
	): boolean {
		this.select(selectionKey);
		if (revision.durableSessionId !== history.durableSessionId) return false;
		if (!hermesHistoryContainsRevision(history, revision)) return false;
		this.checkpoint = revision;
		return true;
	}

	beginCanonicalRefresh(selectionKey: string, now: number): boolean {
		this.select(selectionKey);
		if (
			this.lastCanonicalRefreshAt !== null &&
			now - this.lastCanonicalRefreshAt < HERMES_HISTORY_CANONICAL_FALLBACK_INTERVAL_MS
		) {
			return false;
		}
		this.lastCanonicalRefreshAt = now;
		return true;
	}

	recordRevisionFailure(selectionKey: string, errorUpdatedAt: number, now: number): boolean {
		this.select(selectionKey);
		if (errorUpdatedAt <= 0 || errorUpdatedAt === this.lastRevisionErrorUpdatedAt) return false;
		this.lastRevisionErrorUpdatedAt = errorUpdatedAt;
		this.consecutiveRevisionFailures++;
		return (
			this.consecutiveRevisionFailures >= HERMES_HISTORY_REVISION_FAILURE_THRESHOLD &&
			this.beginCanonicalRefresh(selectionKey, now)
		);
	}

	revisionFailureCount(selectionKey: string): number {
		this.select(selectionKey);
		return this.consecutiveRevisionFailures;
	}

	private select(selectionKey: string): void {
		if (this.selectionKey === selectionKey) return;
		this.selectionKey = selectionKey;
		this.checkpoint = null;
		this.lastCanonicalRefreshAt = null;
		this.consecutiveRevisionFailures = 0;
		this.lastRevisionErrorUpdatedAt = null;
	}
}

function hermesHistoryContainsRevision(
	history: HermesSessionHistory,
	revision: HermesSessionRevision
): boolean {
	if (!revision.latestMessageIdIsStable) return false;
	return revision.latestMessageId === null
		? history.messages.length === 0
		: history.messageIdsAreStable === true &&
				history.messages.some((message) => message.id === revision.latestMessageId);
}

function canReplaceHermesHistoryFromTail(
	current: HermesSessionHistory,
	tail: HermesSessionHistoryPage
): boolean {
	return tail.complete && (tail.view === "durable" || current.view === "active");
}

function hermesHistoryTailContinuation(
	current: HermesSessionHistory,
	tail: HermesSessionHistoryPage
): HermesSessionHistory["messages"] | null {
	if (
		current.messages.length === 0 ||
		current.messageIdsAreStable !== true ||
		tail.messages.length === 0 ||
		!tail.messageIdsAreStable
	) {
		return null;
	}
	const currentIds = current.messages.map((message) => message.id);
	if (new Set(currentIds).size !== currentIds.length) return null;
	const orientations = [tail.messages];
	if (tail.messages.length > 1) orientations.push([...tail.messages].reverse());
	for (const messages of orientations) {
		const tailIds = messages.map((message) => message.id);
		if (new Set(tailIds).size !== tailIds.length) continue;
		const overlapStart = currentIds.indexOf(tailIds[0] ?? "");
		if (overlapStart < 0) continue;
		const overlapLength = currentIds.length - overlapStart;
		if (overlapLength > tailIds.length) continue;
		if (!currentIds.slice(overlapStart).every((messageId, index) => messageId === tailIds[index])) {
			continue;
		}
		if (tailIds.slice(overlapLength).some((messageId) => currentIds.includes(messageId))) {
			continue;
		}
		const merged = [...current.messages.slice(0, overlapStart), ...messages];
		if (tail.total !== null && merged.length !== tail.total) continue;
		return merged;
	}
	return null;
}

export const HERMES_LONG_USER_MESSAGE_CHAR_THRESHOLD = 1_800;
export const HERMES_LONG_USER_MESSAGE_LINE_THRESHOLD = 16;

export interface HermesUserMessageDisclosure {
	collapsible: boolean;
	collapsed: boolean;
	ariaExpanded: boolean;
	label: "Show full message" | "Collapse message";
}

export function hermesUserMessageDisclosure(
	text: string,
	expanded: boolean
): HermesUserMessageDisclosure {
	const collapsible =
		text.length > HERMES_LONG_USER_MESSAGE_CHAR_THRESHOLD ||
		text.split(/\r\n|\r|\n/).length > HERMES_LONG_USER_MESSAGE_LINE_THRESHOLD;
	const collapsed = collapsible && !expanded;
	return {
		collapsible,
		collapsed,
		ariaExpanded: !collapsed,
		label: collapsed ? "Show full message" : "Collapse message",
	};
}

export interface HermesTranscriptPhysicalRowState {
	id: string;
	canonicalMessageId: string | null;
	compactionGeneration: number | null;
	active: boolean | null;
	compacted: boolean | null;
	displayKind: string | null;
	compactionSummaryType: HermesTranscriptMessage["compactionSummaryType"];
}

export interface HermesCanonicalTranscriptMessage extends HermesTranscriptMessage {
	physicalRows: HermesTranscriptPhysicalRowState[];
}

function physicalRowState(message: HermesTranscriptMessage): HermesTranscriptPhysicalRowState {
	return {
		id: message.id,
		canonicalMessageId: message.canonicalMessageId,
		compactionGeneration: message.compactionGeneration,
		active: message.active,
		compacted: message.compacted,
		displayKind: message.displayKind,
		compactionSummaryType: message.compactionSummaryType,
	};
}

export function deriveHermesCanonicalTimeline(
	messages: HermesTranscriptMessage[]
): HermesCanonicalTranscriptMessage[] {
	const explicitCanonicalIds = new Set(
		messages.flatMap((message) =>
			message.canonicalMessageId === null ? [] : [message.canonicalMessageId]
		)
	);
	const groups = new Map<
		string | number,
		{
			displayMessage: HermesTranscriptMessage;
			physicalRows: HermesTranscriptPhysicalRowState[];
		}
	>();
	for (const [index, message] of messages.entries()) {
		const physicalRow = physicalRowState(message);
		const canonicalId =
			message.canonicalMessageId ?? (explicitCanonicalIds.has(message.id) ? message.id : null);
		const groupKey = canonicalId ?? index;
		const existing = groups.get(groupKey);
		if (existing) {
			existing.physicalRows.push(physicalRow);
			if (canonicalId !== null && message.id === canonicalId) {
				existing.displayMessage = message;
			}
			continue;
		}
		groups.set(groupKey, {
			displayMessage: message,
			physicalRows: [physicalRow],
		});
	}
	return [...groups.values()].map(({ displayMessage, physicalRows }) => ({
		...displayMessage,
		physicalRows,
	}));
}

export type HermesTranscriptClassification =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string }
	| { kind: "compaction"; text: string }
	| { kind: "activity"; text: string };

export interface HermesProjectedMessage {
	kind: "message";
	id: string;
	role: "user" | "assistant";
	text: string;
	attachments: HermesProjectedAttachment[];
	delivery?: "pending" | "queued" | "submitting" | "accepted" | "failed";
	followUpId?: string;
	deliveryError?: string | null;
	source: HermesTranscriptMessage;
}

export interface HermesProjectedAttachment {
	id: string;
	name: string;
	kind: HermesAttachmentKind;
	refText: string | null;
}

export interface HermesProjectedActivity {
	kind: "activity";
	id: string;
	messages: HermesTranscriptMessage[];
	status: "complete" | "failed" | "running";
	summary: string;
}

export interface HermesProjectedCompaction {
	kind: "compaction";
	id: string;
	text: string;
	generation: number | null;
	summaryType: string | null;
	createdAt: number | null;
	source: HermesTranscriptMessage;
}

export type HermesTranscriptProjectionItem =
	| HermesProjectedMessage
	| HermesProjectedActivity
	| HermesProjectedCompaction;

// Match stock Hermes' repository window: bound the amount of transcript materialized
// by estimated render cost, while always retaining enough rows to preserve turn context.
export const HERMES_TRANSCRIPT_WINDOW_BUDGET = 1_200;
export const HERMES_TRANSCRIPT_WINDOW_MIN_ITEMS = 30;
const HERMES_TRANSCRIPT_WEIGHT_CHARS = 512;
const hermesTranscriptWeightCache = new WeakMap<object, number>();

function hermesTranscriptItemWeight(item: HermesTranscriptProjectionItem): number {
	const cached = hermesTranscriptWeightCache.get(item);
	if (cached !== undefined) return cached;
	const textLength =
		item.kind === "activity"
			? item.messages.reduce((total, message) => total + message.text.length, 0)
			: item.text.length;
	const rowWeight = item.kind === "activity" ? item.messages.length : 1;
	const weight = Math.max(1, rowWeight + Math.ceil(textLength / HERMES_TRANSCRIPT_WEIGHT_CHARS));
	hermesTranscriptWeightCache.set(item, weight);
	return weight;
}

export interface HermesTranscriptWindow {
	items: HermesTranscriptProjectionItem[];
	windowed: boolean;
}

export function selectHermesTranscriptWindow(
	items: readonly HermesTranscriptProjectionItem[],
	pages = 1
): HermesTranscriptWindow {
	if (items.length === 0)
		return { items: items as HermesTranscriptProjectionItem[], windowed: false };
	const budget = HERMES_TRANSCRIPT_WINDOW_BUDGET * Math.max(1, Math.floor(pages));
	let start = items.length;
	let weight = 0;
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (!item) continue;
		weight += hermesTranscriptItemWeight(item);
		start = index;
		if (weight >= budget && items.length - index >= HERMES_TRANSCRIPT_WINDOW_MIN_ITEMS) break;
	}
	if (start === 0) return { items: items as HermesTranscriptProjectionItem[], windowed: false };
	return { items: items.slice(start), windowed: true };
}

export const HERMES_SESSION_VIRTUALIZE_THRESHOLD = 25;
export const HERMES_SESSION_ROW_ESTIMATE_PX = 58;
export const HERMES_SESSION_VIRTUAL_OVERSCAN_ROWS = 12;

export interface HermesVirtualRange {
	start: number;
	end: number;
}

export function hermesSessionVirtualRange(
	count: number,
	scrollTop: number,
	viewportHeight: number
): HermesVirtualRange {
	if (count < HERMES_SESSION_VIRTUALIZE_THRESHOLD) return { start: 0, end: count };
	const firstVisible = Math.floor(Math.max(0, scrollTop) / HERMES_SESSION_ROW_ESTIMATE_PX);
	const lastVisible = Math.ceil(
		(Math.max(0, scrollTop) + Math.max(HERMES_SESSION_ROW_ESTIMATE_PX, viewportHeight)) /
			HERMES_SESSION_ROW_ESTIMATE_PX
	);
	return {
		start: Math.max(0, firstVisible - HERMES_SESSION_VIRTUAL_OVERSCAN_ROWS),
		end: Math.min(count, lastVisible + HERMES_SESSION_VIRTUAL_OVERSCAN_ROWS),
	};
}

export interface HermesComposerAttachment extends HermesAttachmentMetadata {
	status: "ready" | "attaching" | "error";
	error: string | null;
}

export interface HermesOptimisticUserTurn {
	id: string;
	text: string;
	attachments: Array<Pick<HermesAttachmentMetadata, "kind" | "name">>;
	delivery: "pending" | "queued" | "submitting" | "accepted" | "failed";
	knownCanonicalUserMessageIds: string[];
}

export type HermesComposerAttachmentAction =
	| { type: "add"; attachments: HermesAttachmentMetadata[] }
	| { type: "remove"; handle: string }
	| { type: "submitting" }
	| { type: "failed"; error: string }
	| { type: "succeeded" };

export function reduceHermesComposerAttachments(
	attachments: HermesComposerAttachment[],
	action: HermesComposerAttachmentAction
): HermesComposerAttachment[] {
	switch (action.type) {
		case "add": {
			const handles = new Set(attachments.map((attachment) => attachment.handle));
			return [
				...attachments,
				...action.attachments
					.filter((attachment) => !handles.has(attachment.handle))
					.map((attachment) => ({
						...attachment,
						status: "ready" as const,
						error: null,
					})),
			];
		}
		case "remove":
			if (
				attachments.some(
					(attachment) => attachment.handle === action.handle && attachment.status === "attaching"
				)
			) {
				return attachments;
			}
			return attachments.filter((attachment) => attachment.handle !== action.handle);
		case "submitting":
			return attachments.map((attachment) => ({
				...attachment,
				status: "attaching" as const,
				error: null,
			}));
		case "failed":
			return attachments.map((attachment) => ({
				...attachment,
				status: "error" as const,
				error: action.error,
			}));
		case "succeeded":
			return [];
	}
}

export function hermesComposerTextareaLayout(scrollHeight: number): {
	height: number;
	overflowY: "auto" | "hidden";
} {
	const height = Math.max(56, Math.min(180, scrollHeight));
	return { height, overflowY: scrollHeight > 180 ? "auto" : "hidden" };
}

interface HermesFileTransferLike {
	files?: { length: number };
	items?: ArrayLike<{ kind: string }>;
	types?: ArrayLike<string>;
}

export function hermesComposerContainsFiles(transfer: HermesFileTransferLike): boolean {
	if ((transfer.files?.length ?? 0) > 0) return true;
	for (let index = 0; index < (transfer.items?.length ?? 0); index++) {
		if (transfer.items?.[index]?.kind === "file") return true;
	}
	for (let index = 0; index < (transfer.types?.length ?? 0); index++) {
		if (transfer.types?.[index] === "Files") return true;
	}
	return false;
}

export function hermesComposerTransferAction(
	transfer: HermesFileTransferLike
): "native" | "stage-files" {
	return hermesComposerContainsFiles(transfer) ? "stage-files" : "native";
}

interface HermesRendererFileMetadata {
	name: string;
	size: number;
	type: string;
}

function rendererAttachmentLimit(file: HermesRendererFileMetadata): {
	maxBytes: number;
	message: string;
} {
	const extension = file.name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
	if (
		["avif", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "png", "tif", "tiff", "webp"].includes(
			extension
		)
	) {
		return {
			maxBytes: HERMES_IMAGE_ATTACHMENT_MAX_BYTES,
			message: "Images must be 16 MiB or smaller",
		};
	}
	if (extension === "pdf") {
		return { maxBytes: HERMES_PDF_ATTACHMENT_MAX_BYTES, message: "PDFs must be 50 MiB or smaller" };
	}
	return {
		maxBytes: HERMES_GENERAL_ATTACHMENT_MAX_BYTES,
		message: "Files must be 32 MiB or smaller",
	};
}

export function hermesRendererAttachmentSelectionError(
	files: HermesRendererFileMetadata[],
	existingCount: number
): string | null {
	if (existingCount + files.length > HERMES_MAX_ATTACHMENTS) {
		return `Attach up to ${HERMES_MAX_ATTACHMENTS} files to one message.`;
	}
	let aggregateBytes = 0;
	for (const file of files) {
		if (!Number.isSafeInteger(file.size) || file.size < 0) return "Attachment size is invalid.";
		aggregateBytes += file.size;
		if (aggregateBytes > HERMES_ATTACHMENT_IPC_MAX_BYTES) {
			return "Pasted and dropped files must total 64 MiB or smaller.";
		}
		const limit = rendererAttachmentLimit(file);
		if (file.size > limit.maxBytes) return `${limit.message}: “${file.name}”`;
	}
	return null;
}

export function hermesComposerInteractionPolicy(input: {
	connected: boolean;
	running: boolean;
	submitPending: boolean;
	attachmentPickerPending: boolean;
	attachmentAttaching: boolean;
	hasPayload: boolean;
}): {
	textareaDisabled: boolean;
	sendDisabled: boolean;
	attachmentMutationDisabled: boolean;
} {
	return {
		textareaDisabled: false,
		sendDisabled: !input.hasPayload || input.submitPending,
		attachmentMutationDisabled: input.attachmentPickerPending || input.attachmentAttaching,
	};
}

export function hermesComposerEnterAction(input: {
	connected: boolean;
	running: boolean;
	submitPending: boolean;
	shiftKey: boolean;
	isComposing: boolean;
}): "native" | "preserve" | "submit" {
	if (input.shiftKey || input.isComposing) return "native";
	if (input.submitPending) return "preserve";
	return "submit";
}

function safeProjectedAttachmentName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = Array.from(value.trim())
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.slice(0, 255);
	return name || null;
}

export function extractHermesTranscriptAttachments(
	text: string,
	messageId: string
): { text: string; attachments: HermesProjectedAttachment[] } {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== HERMES_ATTACHMENT_CONTEXT_START) return { text, attachments: [] };
	const endIndex = lines.indexOf(HERMES_ATTACHMENT_CONTEXT_END, 1);
	if (endIndex < 2) return { text, attachments: [] };
	const attachments: HermesProjectedAttachment[] = [];
	for (const [index, row] of lines.slice(1, endIndex).entries()) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(row);
		} catch {
			return { text, attachments: [] };
		}
		if (!parsed || typeof parsed !== "object") return { text, attachments: [] };
		const values = parsed as Record<string, unknown>;
		const kind = values["kind"];
		const name = safeProjectedAttachmentName(values["name"]);
		const rawRef = values["ref"];
		const refText = isSafeHermesFileReference(rawRef) ? rawRef : null;
		if (!name || (kind !== "image" && kind !== "pdf" && kind !== "file")) {
			return { text, attachments: [] };
		}
		attachments.push({
			id: `${messageId}:attachment:${index}`,
			name,
			kind,
			refText,
		});
	}
	const visibleLines = lines.slice(endIndex + 1);
	if (visibleLines[0] === "") visibleLines.shift();
	return { text: visibleLines.join("\n"), attachments };
}

function hermesCanonicalMessageIdentity(message: HermesTranscriptMessage): string {
	const physicalRows = (message as Partial<HermesCanonicalTranscriptMessage>).physicalRows;
	return (
		message.canonicalMessageId ??
		physicalRows?.find((row) => row.canonicalMessageId !== null)?.canonicalMessageId ??
		message.id
	);
}

export function createHermesOptimisticUserTurn(input: {
	id: string;
	text: string;
	attachments: Array<Pick<HermesAttachmentMetadata, "kind" | "name">>;
	canonicalMessages: HermesTranscriptMessage[];
}): HermesOptimisticUserTurn {
	return {
		id: input.id,
		text: input.text.trim() || "Review the attached files.",
		attachments: input.attachments.map(({ kind, name }) => ({ kind, name })),
		delivery: "pending",
		knownCanonicalUserMessageIds: input.canonicalMessages
			.filter((message) => message.role === "user")
			.map(hermesCanonicalMessageIdentity),
	};
}

export function settleHermesOptimisticUserTurn(
	turns: HermesOptimisticUserTurn[],
	id: string,
	result: "queued" | "accepted" | "failed"
): HermesOptimisticUserTurn[] {
	if (result === "failed") return turns.filter((turn) => turn.id !== id);
	return turns.map((turn) => (turn.id === id ? { ...turn, delivery: result } : turn));
}

function hermesOptimisticTurnMatchesMessage(
	turn: HermesOptimisticUserTurn,
	message: HermesTranscriptMessage
): boolean {
	if (message.role !== "user") return false;
	const classification = classifyHermesTranscriptMessage(message);
	if (classification.kind !== "user") return false;
	const presentation = extractHermesTranscriptAttachments(classification.text, message.id);
	return (
		presentation.text === turn.text &&
		presentation.attachments.length === turn.attachments.length &&
		presentation.attachments.every(
			(attachment, index) =>
				attachment.kind === turn.attachments[index]?.kind &&
				attachment.name === turn.attachments[index]?.name
		)
	);
}

export function reconcileHermesOptimisticUserTurns(
	canonicalMessages: HermesTranscriptMessage[],
	turns: HermesOptimisticUserTurn[]
): HermesOptimisticUserTurn[] {
	const canonicalUsers = canonicalMessages.filter((message) => message.role === "user");
	const usedCanonicalIndexes = new Set<number>();
	const unreconciled = turns.filter((turn) => {
		const knownIds = new Set(turn.knownCanonicalUserMessageIds);
		const matchIndex = canonicalUsers.findIndex(
			(message, index) =>
				!usedCanonicalIndexes.has(index) &&
				!knownIds.has(hermesCanonicalMessageIdentity(message)) &&
				hermesOptimisticTurnMatchesMessage(turn, message)
		);
		if (matchIndex < 0) return true;
		usedCanonicalIndexes.add(matchIndex);
		return false;
	});
	return unreconciled.length === turns.length ? turns : unreconciled;
}

export function projectHermesOptimisticUserTurns(
	canonicalMessages: HermesTranscriptMessage[],
	turns: HermesOptimisticUserTurn[],
	followUps: HermesQueuedFollowUpSummary[] = []
): HermesProjectedMessage[] {
	const followUpsById = new Map(followUps.map((followUp) => [followUp.id, followUp]));
	return reconcileHermesOptimisticUserTurns(canonicalMessages, turns).map((turn) => {
		const followUp = followUpsById.get(turn.id);
		const delivery = followUp?.status ?? turn.delivery;
		return {
			kind: "message",
			id: `optimistic-user:${turn.id}`,
			role: "user",
			text: turn.text,
			attachments: turn.attachments.map((attachment, index) => ({
				id: `optimistic-user:${turn.id}:attachment:${index}`,
				kind: attachment.kind,
				name: attachment.name,
				refText: null,
			})),
			delivery,
			followUpId: followUp?.id,
			deliveryError: followUp?.error,
			source: {
				id: `optimistic-user:${turn.id}`,
				canonicalMessageId: null,
				compactionGeneration: null,
				active: true,
				compacted: false,
				displayKind: null,
				compactionSummaryType: null,
				turnId: null,
				role: "user",
				text: turn.text,
				createdAt: null,
				status: delivery,
				toolName: null,
				workspaceArtifacts: [],
			},
		};
	});
}

export function projectHermesQueuedFollowUps(
	canonicalMessages: HermesTranscriptMessage[],
	followUps: HermesQueuedFollowUpSummary[],
	suppressedFollowUpIds: ReadonlySet<string> = new Set()
): HermesProjectedMessage[] {
	const canonicalUsers = canonicalMessages.filter((message) => message.role === "user");
	const usedCanonicalIndexes = new Set<number>();
	const visible = followUps.filter((followUp) => {
		if (suppressedFollowUpIds.has(followUp.id)) return false;
		if (followUp.status !== "accepted") return true;
		const optimistic: HermesOptimisticUserTurn = {
			id: followUp.id,
			text: followUp.text.trim() || "Review the attached files.",
			attachments: followUp.attachments,
			delivery: "accepted",
			knownCanonicalUserMessageIds: followUp.knownCanonicalUserMessageIds,
		};
		const knownIds = new Set(followUp.knownCanonicalUserMessageIds);
		const matchIndex = canonicalUsers.findIndex(
			(message, index) =>
				!usedCanonicalIndexes.has(index) &&
				!knownIds.has(hermesCanonicalMessageIdentity(message)) &&
				hermesOptimisticTurnMatchesMessage(optimistic, message)
		);
		if (matchIndex < 0) return true;
		usedCanonicalIndexes.add(matchIndex);
		return false;
	});
	return visible.map((followUp) => ({
		kind: "message",
		id: `queued-user:${followUp.id}`,
		role: "user",
		text: followUp.text.trim() || "Review the attached files.",
		attachments: followUp.attachments.map((attachment, index) => ({
			id: `queued-user:${followUp.id}:attachment:${index}`,
			kind: attachment.kind,
			name: attachment.name,
			refText: null,
		})),
		delivery: followUp.status,
		followUpId: followUp.id,
		deliveryError: followUp.error,
		source: {
			id: `queued-user:${followUp.id}`,
			canonicalMessageId: null,
			compactionGeneration: null,
			active: true,
			compacted: false,
			displayKind: null,
			compactionSummaryType: null,
			turnId: null,
			role: "user",
			text: followUp.text,
			createdAt: followUp.createdAt,
			status: followUp.status,
			toolName: null,
			workspaceArtifacts: [],
		},
	}));
}

/**
 * Once the main process has supplied a queue event or resume snapshot it is
 * authoritative. A slower query response may describe an older queue
 * generation and must not regress accepted/submitting rows back to queued.
 */
export function selectHermesFollowUpProjection(
	queried: HermesQueuedFollowUpSummary[] | undefined,
	live: HermesQueuedFollowUpSummary[],
	followUpSnapshotReceived: boolean
): HermesQueuedFollowUpSummary[] {
	return followUpSnapshotReceived ? live : (queried ?? live);
}

export function classifyHermesTranscriptMessage(
	message: HermesTranscriptMessage
): HermesTranscriptClassification {
	const text = message.text;
	const substantiveText = text.trim();
	const status = message.status?.trim().toLocaleLowerCase() ?? "";
	if (message.displayKind === "compaction_summary") {
		return { kind: "compaction", text };
	}
	if (message.toolName || message.role === "system" || message.role === "tool") {
		return { kind: "activity", text };
	}
	if (message.role === "user") {
		return substantiveText ? { kind: "user", text } : { kind: "activity", text };
	}
	if (message.role === "assistant" && substantiveText && !FAILED_TRANSCRIPT_STATUSES.has(status)) {
		return { kind: "assistant", text };
	}
	return { kind: "activity", text };
}

export function isVisibleHermesAssistantMessage(message: HermesTranscriptMessage): boolean {
	return classifyHermesTranscriptMessage(message).kind === "assistant";
}

export function hermesActivitySummary(messages: HermesTranscriptMessage[]): {
	status: "complete" | "failed" | "running";
	text: string;
} {
	const statuses = messages.map((message) => message.status?.trim().toLocaleLowerCase() ?? "");
	const failed = statuses.some((status) => FAILED_TRANSCRIPT_STATUSES.has(status));
	const running = !failed && statuses.some((status) => RUNNING_TRANSCRIPT_STATUSES.has(status));
	const actionCount = messages.filter(
		(message) => message.role === "tool" || Boolean(message.toolName)
	).length;
	const count = actionCount || messages.length;
	if (failed) {
		return {
			status: "failed",
			text: count === 1 ? "Action failed" : `${count} actions failed`,
		};
	}
	if (running) {
		return {
			status: "running",
			text: count === 1 ? "Running 1 action" : `Running ${count} actions`,
		};
	}
	if (actionCount > 0) {
		return {
			status: "complete",
			text: actionCount === 1 ? "Ran 1 action" : `Ran ${actionCount} actions`,
		};
	}
	return {
		status: "complete",
		text: messages.length === 1 ? "Session activity" : `${messages.length} session events`,
	};
}

export function projectHermesTranscript(
	messages: HermesTranscriptMessage[]
): HermesTranscriptProjectionItem[] {
	const projected: HermesTranscriptProjectionItem[] = [];
	let activity: HermesTranscriptMessage[] = [];
	const flushActivity = () => {
		const first = activity[0];
		if (!first) return;
		const summary = hermesActivitySummary(activity);
		projected.push({
			kind: "activity",
			id: `activity:${first.id}`,
			messages: activity,
			status: summary.status,
			summary: summary.text,
		});
		activity = [];
	};

	for (const message of messages) {
		if (message.role === "user") flushActivity();
		const classification = classifyHermesTranscriptMessage(message);
		if (classification.kind === "compaction") {
			flushActivity();
			projected.push({
				kind: "compaction",
				id: `compaction:${message.id}`,
				text: classification.text,
				generation: message.compactionGeneration,
				summaryType: message.compactionSummaryType,
				createdAt: message.createdAt,
				source: message,
			});
			continue;
		}
		if (classification.kind === "activity") {
			activity.push(message);
			if (message.role === "user") flushActivity();
			continue;
		}
		flushActivity();
		const presentation =
			classification.kind === "user"
				? extractHermesTranscriptAttachments(classification.text, message.id)
				: { text: classification.text, attachments: [] };
		projected.push({
			kind: "message",
			id: `${classification.kind}:${message.id}`,
			role: classification.kind,
			text: presentation.text,
			attachments: presentation.attachments,
			source: message,
		});
	}
	flushActivity();
	return projected;
}

export function projectHermesLiveActivity(
	live: HermesLiveState,
	canonicalMessages: HermesTranscriptMessage[] = []
): HermesProjectedActivity | null {
	if (!live.running || live.tools.length === 0) return null;
	const durableTools = canonicalMessages.filter(
		(message) => message.role === "tool" || Boolean(message.toolName)
	);
	const visibleTools = live.tools.filter(
		(tool) =>
			!durableTools.some(
				(message) =>
					message.id === tool.id ||
					(Boolean(tool.turnId) && message.turnId === tool.turnId && message.toolName === tool.name)
			)
	);
	if (visibleTools.length === 0) return null;
	const messages: HermesTranscriptMessage[] = visibleTools.map((tool) => ({
		id: tool.id,
		canonicalMessageId: null,
		compactionGeneration: null,
		active: null,
		compacted: null,
		displayKind: null,
		compactionSummaryType: null,
		turnId: tool.turnId,
		role: "tool",
		text: tool.name,
		createdAt: null,
		status: tool.status === "complete" ? "complete" : tool.status,
		toolName: tool.name,
		workspaceArtifacts: [],
	}));
	const summary = hermesActivitySummary(messages);
	return {
		kind: "activity",
		id: `activity:live:${messages[0]?.id ?? "tools"}`,
		messages,
		status: summary.status === "complete" ? "running" : summary.status,
		summary:
			summary.status === "complete"
				? messages.length === 1
					? "Running 1 action"
					: `Running ${messages.length} actions`
				: summary.text,
	};
}

export function projectHermesLiveCompletions(
	canonicalMessages: HermesTranscriptMessage[],
	completed: HermesLiveState["completed"]
): HermesProjectedMessage[] {
	const canonicalAssistant = canonicalMessages.filter(isVisibleHermesAssistantMessage);
	const physicalIds = (message: HermesTranscriptMessage): string[] => {
		const rows = (message as Partial<HermesCanonicalTranscriptMessage>).physicalRows;
		return rows ? rows.map((row) => row.id) : [message.id];
	};
	const usedCanonicalIndexes = new Set<number>();
	const reconciledCompletionIndexes = new Set<number>();
	for (const [completionIndex, completion] of completed.entries()) {
		if (!completion.turnId) continue;
		const canonicalIndex = canonicalAssistant.findIndex(
			(message, index) => !usedCanonicalIndexes.has(index) && message.turnId === completion.turnId
		);
		if (canonicalIndex < 0) continue;
		usedCanonicalIndexes.add(canonicalIndex);
		reconciledCompletionIndexes.add(completionIndex);
	}
	for (const [completionIndex, completion] of completed.entries()) {
		if (reconciledCompletionIndexes.has(completionIndex)) continue;
		const canonicalIndex = canonicalAssistant.findIndex(
			(message, index) =>
				!usedCanonicalIndexes.has(index) &&
				(completion.turnId === null || message.turnId === null) &&
				!physicalIds(message).some((id) => completion.canonicalMessageIds.includes(id)) &&
				classifyHermesTranscriptMessage(message).text === completion.text
		);
		if (canonicalIndex < 0) continue;
		usedCanonicalIndexes.add(canonicalIndex);
		reconciledCompletionIndexes.add(completionIndex);
	}
	const pending = completed.flatMap((completion, index): HermesTranscriptMessage[] => {
		if (!completion.text.trim() || reconciledCompletionIndexes.has(index)) return [];
		return [
			{
				id: `live-complete:${completion.turnId ?? index}`,
				canonicalMessageId: null,
				compactionGeneration: null,
				active: null,
				compacted: null,
				displayKind: null,
				compactionSummaryType: null,
				turnId: completion.turnId,
				role: "assistant",
				text: completion.text,
				createdAt: null,
				status: "complete",
				toolName: null,
				workspaceArtifacts: [],
			},
		];
	});
	return projectHermesTranscript(pending).flatMap((item) =>
		item.kind === "message" ? [item] : []
	);
}

export function hermesConnectionFormPolicy(input: {
	baseUrl: string;
	hasStoredToken: boolean;
	storedBaseUrl: string | null;
	profileId?: string;
	storedProfileId?: string | null;
	tokenInput: string;
}): { showTokenInput: boolean; canSave: boolean } {
	const loopback = isHermesLoopbackUrl(input.baseUrl);
	const sameStoredScope =
		input.hasStoredToken &&
		input.baseUrl.replace(/\/+$/, "") === input.storedBaseUrl?.replace(/\/+$/, "") &&
		(input.storedProfileId === undefined ||
			input.storedProfileId === null ||
			input.profileId === input.storedProfileId);
	return {
		showTokenInput: !loopback,
		canSave: loopback || sameStoredScope || input.tokenInput.length > 0,
	};
}

export function createHermesLiveState(): HermesLiveState {
	return {
		running: false,
		runtimeStatus: null,
		streamingText: "",
		completed: [],
		activeTurnCanonicalAssistantIds: [],
		tools: [],
		pendingApproval: null,
		pendingClarification: null,
		queuedFollowUps: [],
		followUpSnapshotReceived: false,
		subagents: [],
		historyRefreshRequired: false,
		error: null,
	};
}

const TERMINAL_SUBAGENT_STATUSES = new Set(["completed", "failed", "interrupted"]);

function applyHermesSubagentEvent(
	state: HermesLiveState,
	event: HermesRuntimeEvent
): HermesLiveState | null {
	const payload = event.payload.subagent;
	if (!payload) return null;
	const index = state.subagents.findIndex(
		(candidate) => candidate.subagentId === payload.subagentId
	);
	const previous = index >= 0 ? state.subagents[index] : null;
	if (
		previous &&
		TERMINAL_SUBAGENT_STATUSES.has(previous.status) &&
		!TERMINAL_SUBAGENT_STATUSES.has(payload.status)
	) {
		return state;
	}
	const next: HermesLiveSubagent = {
		...payload,
		parentId: payload.parentId ?? previous?.parentId ?? null,
		childSessionId: payload.childSessionId ?? previous?.childSessionId ?? null,
		goal: payload.goal ?? previous?.goal ?? null,
		model: payload.model ?? previous?.model ?? null,
		depth: payload.depth ?? previous?.depth ?? null,
		toolCount: payload.toolCount ?? previous?.toolCount ?? null,
		durationSeconds: payload.durationSeconds ?? previous?.durationSeconds ?? null,
		costUsd: payload.costUsd ?? previous?.costUsd ?? null,
		inputTokens: payload.inputTokens ?? previous?.inputTokens ?? null,
		outputTokens: payload.outputTokens ?? previous?.outputTokens ?? null,
		summary: payload.summary ?? previous?.summary ?? null,
		filesRead: payload.filesRead.length > 0 ? payload.filesRead : (previous?.filesRead ?? []),
		filesWritten:
			payload.filesWritten.length > 0 ? payload.filesWritten : (previous?.filesWritten ?? []),
		latestText: event.text ?? previous?.latestText ?? null,
		currentTool: TERMINAL_SUBAGENT_STATUSES.has(payload.status)
			? null
			: (event.toolName ?? previous?.currentTool ?? null),
		updatedAt: event.receivedAt,
	};
	const subagents = [...state.subagents];
	if (index >= 0) subagents[index] = next;
	else subagents.push(next);
	// Native state is still process-local upstream. Bound the renderer projection
	// while retaining active rows and the most recently updated completed rows.
	const bounded =
		subagents.length <= 100
			? subagents
			: [...subagents]
					.sort((left, right) => {
						const leftActive = TERMINAL_SUBAGENT_STATUSES.has(left.status) ? 0 : 1;
						const rightActive = TERMINAL_SUBAGENT_STATUSES.has(right.status) ? 0 : 1;
						return rightActive - leftActive || right.updatedAt - left.updatedAt;
					})
					.slice(0, 100);
	return { ...state, subagents: bounded };
}

function choicesFrom(event: HermesRuntimeEvent): HermesInteractionChoice[] {
	return event.payload.choices?.map((choice) => ({ ...choice })) ?? [];
}

export function latestReportableHermesMessage(
	messages: HermesTranscriptMessage[]
): HermesTranscriptMessage | null {
	let latest: HermesTranscriptMessage | null = null;
	for (const message of messages) {
		if (!message.id || !isVisibleHermesAssistantMessage(message)) {
			continue;
		}
		if (!latest || (message.createdAt ?? 0) >= (latest.createdAt ?? 0)) latest = message;
	}
	return latest;
}

export function hermesOriginActionAvailability(
	resolvedOrigin: HermesOriginProjection | null | undefined
): { canOpenOrigin: boolean; canReportToOrigin: boolean } {
	return {
		canOpenOrigin: resolvedOrigin?.canOpenThread === true,
		canReportToOrigin: resolvedOrigin?.canReport === true,
	};
}

export function hermesOriginReturnLabel(
	resolvedOrigin: HermesOriginProjection | null | undefined
): string | null {
	if (resolvedOrigin?.canOpenThread !== true) return null;
	const platform = resolvedOrigin.platform.trim().toLowerCase();
	if (platform === "slack") return "Return to Slack";
	if (platform === "telegram") return "Return to Telegram";
	return null;
}

export function hermesReportRequiresExplicitRetry(
	state: { status: string; retryable: boolean } | null | undefined
): boolean {
	return state?.retryable === true && (state.status === "failed" || state.status === "sending");
}

const GENERIC_APPROVAL_CHOICES: HermesInteractionChoice[] = [
	{ value: "allow_once", label: "Allow once" },
	{ value: "deny", label: "Deny" },
];

export function applyHermesActiveTurnSnapshot(
	state: HermesLiveState,
	snapshot: HermesActiveTurnSnapshot,
	canonicalMessages: HermesTranscriptMessage[] = []
): HermesLiveState {
	const canonicalAssistantIds = canonicalMessages
		.filter(isVisibleHermesAssistantMessage)
		.map(hermesCanonicalMessageIdentity);
	return {
		...state,
		running: snapshot.activeTurn,
		runtimeStatus: snapshot.status ?? (snapshot.activeTurn ? "running" : "idle"),
		streamingText: snapshot.activeTurn ? snapshot.streamingText : "",
		tools: snapshot.activeTurn ? snapshot.tools.map((tool) => ({ ...tool })) : [],
		pendingApproval:
			snapshot.activeTurn && snapshot.pendingApproval
				? {
						...snapshot.pendingApproval,
						choices:
							snapshot.pendingApproval.choices.length > 0
								? snapshot.pendingApproval.choices.map((choice) => ({ ...choice }))
								: GENERIC_APPROVAL_CHOICES.map((choice) => ({ ...choice })),
					}
				: null,
		pendingClarification:
			snapshot.activeTurn && snapshot.pendingClarification
				? {
						...snapshot.pendingClarification,
						choices: snapshot.pendingClarification.choices.map((choice) => ({ ...choice })),
					}
				: null,
		queuedFollowUps:
			snapshot.queuedFollowUps?.map((followUp) => ({
				...followUp,
				attachments: followUp.attachments.map((attachment) => ({ ...attachment })),
			})) ?? [],
		followUpSnapshotReceived: true,
		activeTurnCanonicalAssistantIds: snapshot.activeTurn
			? state.running
				? state.activeTurnCanonicalAssistantIds
				: canonicalAssistantIds
			: [],
		subagents: snapshot.subagents?.map((subagent) => ({ ...subagent })) ?? state.subagents,
		error: null,
	};
}

export function applyHermesEvent(
	state: HermesLiveState,
	event: HermesRuntimeEvent,
	selectedSessionId?: string,
	canonicalMessages: HermesTranscriptMessage[] = []
): HermesLiveState {
	const subagentState = applyHermesSubagentEvent(state, event);
	if (subagentState) return subagentState;
	switch (event.type) {
		case "runtime.active-turn-snapshot":
			return event.payload.activeTurnSnapshot
				? applyHermesActiveTurnSnapshot(state, event.payload.activeTurnSnapshot, canonicalMessages)
				: state;
		case "runtime.follow-up-queue":
			return {
				...state,
				queuedFollowUps:
					event.payload.queuedFollowUps?.map((followUp) => ({
						...followUp,
						attachments: followUp.attachments.map((attachment) => ({ ...attachment })),
					})) ?? [],
				followUpSnapshotReceived: true,
			};
		case "message.start":
			return {
				...state,
				running: true,
				runtimeStatus: "running",
				streamingText: "",
				activeTurnCanonicalAssistantIds: canonicalMessages
					.filter(isVisibleHermesAssistantMessage)
					.map(hermesCanonicalMessageIdentity),
				subagents: state.subagents.filter(
					(subagent) => subagent.status === "running" || subagent.status === "queued"
				),
				error: null,
			};
		case "message.delta":
			return {
				...state,
				running: true,
				runtimeStatus: "streaming",
				streamingText: state.streamingText + (event.text ?? ""),
				error: null,
			};
		case "message.complete":
			return {
				...state,
				running: false,
				runtimeStatus: event.status ?? "complete",
				streamingText: "",
				activeTurnCanonicalAssistantIds: [],
				completed:
					event.status === "error"
						? state.completed
						: [
								...state.completed,
								{
									turnId: event.turnId,
									text: event.text ?? state.streamingText,
									canonicalMessageIds: state.activeTurnCanonicalAssistantIds,
								},
							],
				pendingApproval: null,
				pendingClarification: null,
				error: event.status === "error" ? (event.text ?? "Hermes turn failed") : null,
			};
		case "tool.start":
			return {
				...state,
				running: true,
				runtimeStatus: "running",
				tools: [
					...state.tools,
					{
						id: event.requestId ?? `${event.toolName ?? "tool"}-${state.tools.length}`,
						turnId: event.turnId,
						name: event.toolName ?? "Tool",
						status: "running",
					},
				],
			};
		case "tool.complete": {
			let updated = false;
			const tools = state.tools.map((tool) => {
				if (
					updated ||
					tool.status !== "running" ||
					(event.requestId && tool.id !== event.requestId) ||
					(!event.requestId && event.toolName && tool.name !== event.toolName)
				) {
					return tool;
				}
				updated = true;
				return { ...tool, status: event.status === "error" ? "failed" : "complete" } as const;
			});
			return { ...state, tools };
		}
		case "approval.request": {
			const choices = choicesFrom(event);
			return {
				...state,
				pendingApproval: {
					requestId: event.requestId ?? "approval",
					prompt: event.text ?? "Hermes needs approval",
					choices: choices.length > 0 ? choices : GENERIC_APPROVAL_CHOICES,
				},
			};
		}
		case "clarify.request":
			return {
				...state,
				pendingClarification: {
					requestId: event.requestId ?? "clarification",
					prompt: event.text ?? "Hermes needs more information",
					choices: choicesFrom(event),
				},
			};
		case "approval.expire":
		case "approval.expired":
			return event.requestId && state.pendingApproval?.requestId !== event.requestId
				? state
				: { ...state, pendingApproval: null };
		case "clarify.expire":
		case "clarify.expired":
			return event.requestId && state.pendingClarification?.requestId !== event.requestId
				? state
				: { ...state, pendingClarification: null };
		case "session.info": {
			const runtimeStatus = event.status?.toLocaleLowerCase() ?? null;
			return {
				...state,
				runtimeStatus,
				running: ["busy", "queued", "running", "streaming"].includes(runtimeStatus ?? ""),
			};
		}
		case "turn.complete":
		case "turn.completed":
			return {
				...state,
				running: false,
				runtimeStatus: event.status ?? "complete",
				historyRefreshRequired: true,
				pendingApproval: null,
				pendingClarification: null,
			};
		case "turn.failed":
			return {
				...state,
				running: false,
				runtimeStatus: "failed",
				error: event.text ?? "Hermes turn failed",
				pendingApproval: null,
				pendingClarification: null,
			};
		case "turn.cancelled":
			return {
				...state,
				running: false,
				runtimeStatus: "cancelled",
				error: event.text ?? "Hermes turn was interrupted",
				pendingApproval: null,
				pendingClarification: null,
			};
		case "runtime.history-refresh-required": {
			const binding = selectedSessionId
				? event.payload.bindings?.find(
						(candidate) =>
							candidate.hermesSessionId === selectedSessionId ||
							candidate.durableSessionId === selectedSessionId
					)
				: undefined;
			if (!binding) return { ...state, historyRefreshRequired: true };
			return {
				...state,
				running: binding.activeTurn,
				runtimeStatus: binding.status ?? (binding.activeTurn ? "running" : "idle"),
				streamingText: binding.activeTurn ? state.streamingText : "",
				pendingApproval: binding.activeTurn ? state.pendingApproval : null,
				pendingClarification: binding.activeTurn ? state.pendingClarification : null,
				historyRefreshRequired: true,
			};
		}
		case "runtime.error":
		case "error":
			return {
				...state,
				running: false,
				runtimeStatus: "error",
				error: event.text ?? "Hermes runtime error",
			};
		default:
			return state;
	}
}

export function filterHermesSessions(
	sessions: HermesSessionSummary[],
	filter: HermesSessionFilter,
	query: string,
	linkedBranchesBySession: Record<string, string[]>
): HermesSessionSummary[] {
	const needle = query.trim().toLocaleLowerCase();
	return sessions.filter((session) => {
		if (filter === "open" && session.archived) return false;
		if (filter === "archived" && !session.archived) return false;
		if (!needle) return true;
		const haystack = [
			session.title,
			...session.tags.map((tag) => tag.name),
			session.preview,
			session.source,
			session.profileId,
			session.origin?.displayLabel ?? "",
			session.origin?.workspaceLabel ?? "",
			session.origin?.accountLabel ?? "",
			session.origin?.chatLabel ?? "",
			session.origin?.channelLabel ?? "",
			session.origin?.threadLabel ?? "",
			...(linkedBranchesBySession[hermesSessionIdentityKey(session.profileId, session.id)] ?? []),
		]
			.join("\n")
			.toLocaleLowerCase();
		return haystack.includes(needle);
	});
}

export function groupHermesSessions(sessions: HermesSessionSummary[]): {
	handovers: HermesSessionSummary[];
	sessions: HermesSessionSummary[];
} {
	return {
		handovers: sessions.filter((session) => session.handover),
		sessions: sessions.filter((session) => !session.handover),
	};
}
