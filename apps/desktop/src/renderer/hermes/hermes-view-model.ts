import type {
	HermesRuntimeEvent,
	HermesSessionSummary,
	HermesTurnResult,
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
	name: string;
	status: "running" | "complete" | "failed";
}

export interface HermesLiveState {
	running: boolean;
	streamingText: string;
	completed: Array<{ turnId: string | null; text: string }>;
	tools: HermesLiveTool[];
	pendingApproval: HermesPendingInteraction | null;
	pendingClarification: HermesPendingInteraction | null;
	historyRefreshRequired: boolean;
	error: string | null;
}

export function createHermesLiveState(): HermesLiveState {
	return {
		running: false,
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

export function latestReportableHermesTurnResult(
	turnResults: HermesTurnResult[]
): HermesTurnResult | null {
	let latest: HermesTurnResult | null = null;
	for (const result of turnResults) {
		const status = result.status?.toLocaleLowerCase();
		if (
			!result.turnId ||
			!result.content ||
			["error", "failed", "cancelled"].includes(status ?? "")
		) {
			continue;
		}
		if (!latest || (result.completedAt ?? 0) >= (latest.completedAt ?? 0)) latest = result;
	}
	return latest;
}

export function hermesOriginActionAvailability(
	session: Pick<HermesSessionSummary, "canReportToOrigin">,
	resolvedOrigin: { canOpen: boolean } | null | undefined
): { canOpenOrigin: boolean; canReportToOrigin: boolean } {
	return {
		canOpenOrigin: resolvedOrigin?.canOpen === true,
		canReportToOrigin: session.canReportToOrigin,
	};
}

const GENERIC_APPROVAL_CHOICES: HermesInteractionChoice[] = [
	{ value: "allow_once", label: "Allow once" },
	{ value: "deny", label: "Deny" },
];

export function applyHermesEvent(
	state: HermesLiveState,
	event: HermesRuntimeEvent
): HermesLiveState {
	switch (event.type) {
		case "message.delta":
			return {
				...state,
				running: true,
				streamingText: state.streamingText + (event.text ?? ""),
				error: null,
			};
		case "message.complete":
			return {
				...state,
				running: false,
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
		case "runtime.history-refresh-required":
			return { ...state, historyRefreshRequired: true };
		case "runtime.error":
		case "error":
			return { ...state, running: false, error: event.text ?? "Hermes runtime error" };
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
		if (filter === "open" && (!session.open || session.archived)) return false;
		if (filter === "archived" && !session.archived) return false;
		if (!needle) return true;
		const haystack = [
			session.title,
			session.preview,
			session.source,
			session.originLabel ?? "",
			...(linkedBranchesBySession[session.id] ?? []),
		]
			.join("\n")
			.toLocaleLowerCase();
		return haystack.includes(needle);
	});
}
