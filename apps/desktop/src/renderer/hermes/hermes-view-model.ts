import type {
	HermesAttachmentKind,
	HermesAttachmentMetadata,
	HermesOriginProjection,
	HermesRuntimeEvent,
	HermesSessionSummary,
	HermesTranscriptMessage,
} from "../../shared/hermes";
import {
	HERMES_ATTACHMENT_CONTEXT_END,
	HERMES_ATTACHMENT_CONTEXT_START,
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

export interface HermesLiveState {
	running: boolean;
	runtimeStatus: string | null;
	streamingText: string;
	completed: Array<{ turnId: string | null; text: string; canonicalMessageIds: string[] }>;
	tools: HermesLiveTool[];
	pendingApproval: HermesPendingInteraction | null;
	pendingClarification: HermesPendingInteraction | null;
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
	canvas: "mx-auto w-full min-w-0 max-w-[720px]",
	arbitraryContent: "min-w-0 break-words [overflow-wrap:anywhere]",
	technicalDetail: "max-h-64 min-w-0 overflow-x-auto overflow-y-auto",
} as const;

export type HermesTranscriptClassification =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string }
	| { kind: "activity"; text: string };

export interface HermesProjectedMessage {
	kind: "message";
	id: string;
	role: "user" | "assistant";
	text: string;
	attachments: HermesProjectedAttachment[];
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

export type HermesTranscriptProjectionItem = HermesProjectedMessage | HermesProjectedActivity;

export interface HermesComposerAttachment extends HermesAttachmentMetadata {
	status: "ready" | "attaching" | "error";
	error: string | null;
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

export function classifyHermesTranscriptMessage(
	message: HermesTranscriptMessage
): HermesTranscriptClassification {
	const text = message.text;
	const substantiveText = text.trim();
	const status = message.status?.trim().toLocaleLowerCase() ?? "";
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
				!completion.canonicalMessageIds.includes(message.id) &&
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

export interface HermesTicketChoice {
	value: string;
	topic: string;
	workspaceId: string;
	label: string;
}

export function buildHermesTicketChoices(
	cached:
		| {
				jiraIssues?: Array<{ key: string; summary: string }>;
				linearIssues?: Array<{ id: string; identifier: string; title: string }>;
		  }
		| null
		| undefined,
	links: Array<{ provider: string; ticketId: string; workspaceId: string }> | null | undefined,
	workspaces:
		| Array<{
				id: string;
				projectName: string;
				name: string;
				branch: string | null;
		  }>
		| null
		| undefined
): HermesTicketChoice[] {
	const topics = new Map<string, string>();
	for (const issue of cached?.jiraIssues ?? []) {
		topics.set(`jira:${issue.key}`, `${issue.key}: ${issue.summary}`);
	}
	for (const issue of cached?.linearIssues ?? []) {
		topics.set(`linear:${issue.id}`, `${issue.identifier}: ${issue.title}`);
	}
	const workspaceById = new Map((workspaces ?? []).map((workspace) => [workspace.id, workspace]));
	const choices = new Map<string, HermesTicketChoice>();
	for (const link of links ?? []) {
		if (link.provider !== "jira" && link.provider !== "linear") continue;
		const topic = topics.get(`${link.provider}:${link.ticketId}`);
		const workspace = workspaceById.get(link.workspaceId);
		if (!topic || !workspace) continue;
		const value = `${link.provider}:${link.ticketId}:${link.workspaceId}`;
		choices.set(value, {
			value,
			topic,
			workspaceId: link.workspaceId,
			label: `${topic} · ${workspace.projectName} / ${workspace.branch ?? workspace.name}`,
		});
	}
	return [...choices.values()];
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
		tools: [],
		pendingApproval: null,
		pendingClarification: null,
		historyRefreshRequired: false,
		error: null,
	};
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

export function hermesReportRequiresExplicitRetry(
	state: { status: string; retryable: boolean } | null | undefined
): boolean {
	return state?.retryable === true && (state.status === "failed" || state.status === "sending");
}

const GENERIC_APPROVAL_CHOICES: HermesInteractionChoice[] = [
	{ value: "allow_once", label: "Allow once" },
	{ value: "deny", label: "Deny" },
];

export function applyHermesEvent(
	state: HermesLiveState,
	event: HermesRuntimeEvent,
	selectedSessionId?: string,
	canonicalMessages: HermesTranscriptMessage[] = []
): HermesLiveState {
	switch (event.type) {
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
				completed:
					event.status === "error"
						? state.completed
						: [
								...state.completed,
								{
									turnId: event.turnId,
									text: event.text ?? state.streamingText,
									canonicalMessageIds: canonicalMessages
										.filter(isVisibleHermesAssistantMessage)
										.map((message) => message.id),
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
		case "approval.expired":
			return { ...state, pendingApproval: null };
		case "clarify.expired":
			return { ...state, pendingClarification: null };
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
			};
		case "turn.failed":
			return {
				...state,
				running: false,
				runtimeStatus: "failed",
				error: event.text ?? "Hermes turn failed",
			};
		case "turn.cancelled":
			return {
				...state,
				running: false,
				runtimeStatus: "cancelled",
				error: event.text ?? "Hermes turn was interrupted",
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
			session.preview,
			session.source,
			session.profileId,
			session.origin?.displayLabel ?? "",
			session.origin?.workspaceLabel ?? "",
			session.origin?.accountLabel ?? "",
			session.origin?.chatLabel ?? "",
			session.origin?.channelLabel ?? "",
			session.origin?.threadLabel ?? "",
			...(linkedBranchesBySession[session.id] ?? []),
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
