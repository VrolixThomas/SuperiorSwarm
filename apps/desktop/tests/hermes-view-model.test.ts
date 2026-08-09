import { describe, expect, test } from "bun:test";
import {
	applyHermesEvent,
	createHermesLiveState,
	filterHermesSessions,
	hermesConnectionFormPolicy,
	hermesOriginActionAvailability,
	latestReportableHermesMessage,
} from "../src/renderer/hermes/hermes-view-model";
import type {
	HermesRuntimeEvent,
	HermesSessionSummary,
	HermesTranscriptMessage,
} from "../src/shared/hermes";

const session = (overrides: Partial<HermesSessionSummary> = {}): HermesSessionSummary => ({
	id: "session-1",
	title: "Checkout bug",
	preview: "Investigating",
	profileId: "default",
	source: "slack",
	updatedAt: 10,
	createdAt: 1,
	archived: false,
	running: false,
	busy: false,
	waitingForUser: false,
	messageCount: 2,
	origin: {
		platform: "slack",
		displayLabel: "#engineering",
		hasThread: true,
		canOpenThread: false,
		canReport: false,
		openUrl: null,
	},
	...overrides,
});

const event = (type: string, payload: Partial<HermesRuntimeEvent> = {}): HermesRuntimeEvent => ({
	type,
	runtimeSessionId: "runtime-1",
	durableSessionId: "session-1",
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

const message = (overrides: Partial<HermesTranscriptMessage> = {}): HermesTranscriptMessage => ({
	id: "assistant-1",
	turnId: "turn-1",
	role: "assistant",
	text: "Complete update",
	createdAt: 1,
	status: "complete",
	toolName: null,
	workspaceArtifacts: [],
	...overrides,
});

describe("Hermes renderer view model", () => {
	test("hides loopback token entry and enables save without renderer credentials", () => {
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "http://127.0.0.1:8080",
				hasStoredToken: false,
				storedBaseUrl: null,
				tokenInput: "",
			})
		).toEqual({ showTokenInput: false, canSave: true });
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "https://hermes.example.com",
				hasStoredToken: false,
				storedBaseUrl: null,
				tokenInput: "",
			})
		).toEqual({ showTokenInput: true, canSave: false });
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "https://hermes.example.com",
				hasStoredToken: false,
				storedBaseUrl: null,
				tokenInput: "explicit-remote-token",
			})
		).toEqual({ showTokenInput: true, canSave: true });
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "https://hermes.example.com",
				hasStoredToken: true,
				storedBaseUrl: "http://127.0.0.1:8080",
				tokenInput: "",
			})
		).toEqual({ showTokenInput: true, canSave: false });
	});

	test("filters active/archived sessions and searches source, profile, origin, or linked branch", () => {
		const active = session();
		const archived = session({ id: "session-2", title: "Release", archived: true });
		const sessions = [active, archived];
		expect(filterHermesSessions(sessions, "open", "engineering", {})).toEqual([active]);
		expect(
			filterHermesSessions(sessions, "all", "feat/payments", {
				"session-2": ["feat/payments"],
			})
		).toEqual([archived]);
		expect(filterHermesSessions(sessions, "archived", "default", {})).toEqual([archived]);
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
			event("runtime.history-refresh-required", { runtimeSessionId: null })
		);
		expect(state.historyRefreshRequired).toBe(true);
	});

	test("surfaces queued, failed, interrupted, and expired stock runtime states", () => {
		let state = applyHermesEvent(
			createHermesLiveState(),
			event("session.info", { status: "queued" })
		);
		expect(state).toMatchObject({ running: true, runtimeStatus: "queued" });
		state = applyHermesEvent(
			{ ...state, pendingApproval: { requestId: "a", prompt: "Approve", choices: [] } },
			event("approval.expired")
		);
		expect(state.pendingApproval).toBeNull();
		state = applyHermesEvent(state, event("turn.failed", { text: "Provider rejected" }));
		expect(state).toMatchObject({ running: false, error: "Provider rejected" });
		state = applyHermesEvent({ ...state, running: true, error: null }, event("turn.cancelled"));
		expect(state).toMatchObject({ running: false, error: "Hermes turn was interrupted" });
	});

	test("keeps response values and safely formatted labels for server choices", () => {
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
		expect(state.pendingApproval?.choices).toEqual([
			{ value: "allow_once", label: "Allow this deployment" },
			{ value: "deny", label: "Stop and return to the agent" },
		]);
	});

	test("provides conservative generic approval choices when Hermes omits them", () => {
		const state = applyHermesEvent(createHermesLiveState(), event("approval.request"));
		expect(state.pendingApproval?.choices).toEqual([
			{ value: "allow_once", label: "Allow once" },
			{ value: "deny", label: "Deny" },
		]);
	});

	test("does not offer failed or non-assistant history as a report update", () => {
		expect(
			latestReportableHermesMessage([
				message({ id: "assistant-ok", createdAt: 100 }),
				message({ id: "assistant-failed", status: "failed", createdAt: 300 }),
				message({ id: "user-1", role: "user", createdAt: 400 }),
			])
		).toMatchObject({ id: "assistant-ok" });
	});

	test("uses only the resolved redacted projection for optional origin actions", () => {
		expect(
			hermesOriginActionAvailability({
				platform: "slack",
				displayLabel: "Slack",
				hasThread: true,
				canOpenThread: true,
				canReport: true,
				openUrl: "https://app.slack.com/client/T1/C1/thread-C1-1",
			})
		).toEqual({ canOpenOrigin: true, canReportToOrigin: true });
		expect(hermesOriginActionAvailability(undefined)).toEqual({
			canOpenOrigin: false,
			canReportToOrigin: false,
		});
	});
});
