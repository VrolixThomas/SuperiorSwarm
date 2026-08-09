import type {
	HermesOriginProjection,
	HermesRuntimeEvent,
	HermesSessionSummary,
	HermesTranscriptMessage,
} from "../../shared/hermes";
import { isHermesLoopbackUrl } from "../../shared/hermes";

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
	name: string;
	status: "running" | "complete" | "failed";
}

export interface HermesLiveState {
	running: boolean;
	runtimeStatus: string | null;
	streamingText: string;
	completed: Array<{ turnId: string | null; text: string }>;
	tools: HermesLiveTool[];
	pendingApproval: HermesPendingInteraction | null;
	pendingClarification: HermesPendingInteraction | null;
	historyRefreshRequired: boolean;
	error: string | null;
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
		const status = message.status?.toLocaleLowerCase();
		if (
			message.role !== "assistant" ||
			!message.id ||
			!message.text.trim() ||
			["error", "failed", "cancelled", "interrupted"].includes(status ?? "")
		) {
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
	selectedSessionId?: string
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
								{ turnId: event.turnId, text: event.text ?? state.streamingText },
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
