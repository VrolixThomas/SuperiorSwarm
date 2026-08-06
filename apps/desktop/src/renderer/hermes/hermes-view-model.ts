import type { HermesRuntimeEvent, HermesSessionSummary } from "../../shared/hermes";

export type HermesSessionFilter = "open" | "all" | "archived";

export interface HermesPendingInteraction {
	requestId: string;
	prompt: string;
	choices: string[];
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

function choicesFrom(event: HermesRuntimeEvent): string[] {
	const choices = event.payload["choices"];
	if (!Array.isArray(choices)) return [];
	return choices.flatMap((choice) => {
		if (typeof choice === "string") return [choice];
		if (choice && typeof choice === "object") {
			const value = (choice as Record<string, unknown>)["value"];
			if (typeof value === "string") return [value];
		}
		return [];
	});
}

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
		case "approval.request":
			return {
				...state,
				pendingApproval: {
					requestId: event.requestId ?? "approval",
					prompt: event.text ?? "Hermes needs approval",
					choices: choicesFrom(event),
				},
			};
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
