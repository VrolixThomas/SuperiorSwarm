import { describe, expect, test } from "bun:test";
import {
	applyHermesEvent,
	createHermesLiveState,
	filterHermesSessions,
	hermesOriginActionAvailability,
	latestReportableHermesTurnResult,
} from "../src/renderer/hermes/hermes-view-model";
import type { HermesRuntimeEvent, HermesSessionSummary } from "../src/shared/hermes";

const session = (overrides: Partial<HermesSessionSummary> = {}): HermesSessionSummary => ({
	id: "session-1",
	lineageTipId: "session-1",
	lineageRootId: null,
	title: "Checkout bug",
	preview: "Investigating",
	profileId: "default",
	source: "slack",
	updatedAt: 10,
	createdAt: 1,
	open: true,
	archived: false,
	running: false,
	busy: false,
	claimed: false,
	waitingForUser: false,
	originLabel: "#engineering",
	canOpenOrigin: true,
	canReportToOrigin: true,
	opaqueOriginRef: "origin-1",
	...overrides,
});

const event = (type: string, payload: Partial<HermesRuntimeEvent> = {}): HermesRuntimeEvent => ({
	type,
	sessionId: "runtime-1",
	turnId: "turn-1",
	requestId: null,
	text: null,
	toolName: null,
	status: null,
	payload: {},
	workspaceArtifacts: [],
	receivedAt: 1,
	...payload,
});

describe("Hermes renderer view model", () => {
	test("filters open/archived sessions and searches origin or linked branch", () => {
		const openSession = session();
		const archivedSession = session({
			id: "session-2",
			title: "Release",
			open: false,
			archived: true,
		});
		const sessions = [openSession, archivedSession];
		expect(filterHermesSessions(sessions, "open", "engineering", {})).toEqual([openSession]);
		expect(
			filterHermesSessions(sessions, "all", "feat/payments", {
				"session-2": ["feat/payments"],
			})
		).toEqual([archivedSession]);
		expect(filterHermesSessions(sessions, "archived", "", {})).toEqual([archivedSession]);
	});

	test("reduces streaming, tool, approval, clarification, and completion events", () => {
		let state = createHermesLiveState();
		state = applyHermesEvent(state, event("message.delta", { text: "Hel" }));
		state = applyHermesEvent(state, event("message.delta", { text: "lo" }));
		state = applyHermesEvent(state, event("tool.start", { toolName: "create_worktree" }));
		state = applyHermesEvent(
			state,
			event("approval.request", { requestId: "approval-1", text: "Allow command?" })
		);
		state = applyHermesEvent(
			state,
			event("clarify.request", { requestId: "clarify-1", text: "Which repo?" })
		);
		expect(state.streamingText).toBe("Hello");
		expect(state.running).toBe(true);
		expect(state.tools[0]?.status).toBe("running");
		expect(state.pendingApproval?.requestId).toBe("approval-1");
		expect(state.pendingClarification?.requestId).toBe("clarify-1");

		state = applyHermesEvent(state, event("tool.complete", { toolName: "create_worktree" }));
		state = applyHermesEvent(
			state,
			event("message.complete", { text: "Hello world", status: "complete" })
		);
		expect(state.running).toBe(false);
		expect(state.streamingText).toBe("");
		expect(state.completed.at(-1)).toEqual({ turnId: "turn-1", text: "Hello world" });
		expect(state.tools[0]?.status).toBe("complete");
	});

	test("requests canonical refresh after a reconnect", () => {
		const state = applyHermesEvent(
			createHermesLiveState(),
			event("runtime.history-refresh-required", { sessionId: null })
		);
		expect(state.historyRefreshRequired).toBe(true);
	});

	test("keeps the response values and safely formatted labels for every offered choice", () => {
		const state = applyHermesEvent(
			createHermesLiveState(),
			event("approval.request", {
				requestId: "approval-choices",
				text: "Deploy to production?",
				payload: {
					choices: [
						{ value: "allow_once", label: "Allow this deployment" },
						{ value: "deny", label: "Stop and return to the agent" },
					],
				},
			})
		);

		expect(state.pendingApproval).toEqual({
			requestId: "approval-choices",
			prompt: "Deploy to production?",
			choices: [
				{ value: "allow_once", label: "Allow this deployment" },
				{ value: "deny", label: "Stop and return to the agent" },
			],
		});
	});

	test("provides conservative generic approval choices when Hermes omits them", () => {
		const state = applyHermesEvent(createHermesLiveState(), event("approval.request"));

		expect(state.pendingApproval).toEqual({
			requestId: "approval",
			prompt: "Hermes needs approval",
			choices: [
				{ value: "allow_once", label: "Allow once" },
				{ value: "deny", label: "Deny" },
			],
		});
	});

	test("does not offer a failed turn as reportable completed output", () => {
		const state = applyHermesEvent(
			createHermesLiveState(),
			event("message.complete", { text: "token=private failure", status: "error" })
		);

		expect(state.completed).toEqual([]);
		expect(state.error).toBe("token=private failure");
	});

	test("selects the latest successful durable turn result without a live completion event", () => {
		expect(
			latestReportableHermesTurnResult([
				{ turnId: "turn-newer-error", content: "Failed", completedAt: 300, status: "error" },
				{ turnId: "turn-old", content: "Old result", completedAt: 100, status: "complete" },
				{ turnId: "turn-latest", content: "Latest result", completedAt: 200, status: "complete" },
			])
		).toEqual({
			turnId: "turn-latest",
			content: "Latest result",
			completedAt: 200,
			status: "complete",
		});
	});

	test("keeps reporting available from the catalog when origin link lookup fails", () => {
		expect(hermesOriginActionAvailability(session(), undefined)).toEqual({
			canOpenOrigin: false,
			canReportToOrigin: true,
		});
	});
});
