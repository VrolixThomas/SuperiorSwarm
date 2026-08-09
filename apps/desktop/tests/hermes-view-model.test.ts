import { describe, expect, test } from "bun:test";
import {
	HERMES_CHAT_OVERFLOW_CLASSES,
	applyHermesEvent,
	buildHermesTicketChoices,
	classifyHermesTranscriptMessage,
	createHermesLiveState,
	filterHermesSessions,
	groupHermesSessions,
	hermesActivitySummary,
	hermesConnectionFormPolicy,
	hermesOriginActionAvailability,
	hermesReportRequiresExplicitRetry,
	latestReportableHermesMessage,
	projectHermesLiveActivity,
	projectHermesLiveCompletions,
	projectHermesTranscript,
	reduceHermesComposerAttachments,
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
	handover: false,
	origin: {
		platform: "slack",
		source: "slack",
		displayLabel: "#engineering",
		workspaceLabel: null,
		accountLabel: null,
		chatLabel: null,
		channelLabel: "#engineering",
		threadLabel: null,
		hasThread: true,
		canOpenThread: false,
		canReport: false,
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
	test("projects only user turns and substantive assistant prose into conversation", () => {
		const canonical = [
			message({ id: "system-1", role: "system", text: "Session resumed" }),
			message({ id: "tool-1", role: "tool", text: "Checked status", toolName: "terminal" }),
			message({ id: "assistant-empty", text: "   " }),
			message({ id: "user-1", role: "user", text: "Please continue" }),
			message({ id: "assistant-prose", text: "Tool: this is still assistant prose." }),
			message({
				id: "assistant-artifact",
				text: "",
				workspaceArtifacts: [
					{
						kind: "superiorswarm.workspace.created",
						workspaceId: "workspace-1",
						projectId: "project-1",
						branch: "feat/chat",
						worktreePath: "/tmp/worktree",
					},
				],
			}),
		];
		const snapshot = structuredClone(canonical);

		const projected = projectHermesTranscript(canonical);

		expect(projected.map((item) => [item.kind, item.id])).toEqual([
			["activity", "activity:system-1"],
			["message", "user:user-1"],
			["message", "assistant:assistant-prose"],
			["activity", "activity:assistant-artifact"],
		]);
		expect(projected[0]).toMatchObject({
			kind: "activity",
			messages: [{ id: "system-1" }, { id: "tool-1" }, { id: "assistant-empty" }],
		});
		expect(projected[2]).toMatchObject({
			kind: "message",
			role: "assistant",
			text: "Tool: this is still assistant prose.",
		});
		expect(canonical).toEqual(snapshot);
	});

	test("does not join activity across any user boundary", () => {
		const projected = projectHermesTranscript([
			message({ id: "tool-before", role: "tool", toolName: "read", text: "before" }),
			message({ id: "empty-user", role: "user", text: "" }),
			message({ id: "tool-after", role: "tool", toolName: "write", text: "after" }),
		]);

		expect(projected).toHaveLength(3);
		expect(projected.map((item) => item.id)).toEqual([
			"activity:tool-before",
			"activity:empty-user",
			"activity:tool-after",
		]);
	});

	test("keeps failed assistant scaffolding in activity and reports a textual failure summary", () => {
		const failed = message({
			id: "assistant-failed",
			text: "Provider returned a failure",
			status: "failed",
		});

		expect(classifyHermesTranscriptMessage(failed).kind).toBe("activity");
		expect(hermesActivitySummary([failed])).toEqual({
			status: "failed",
			text: "Action failed",
		});
	});

	test("unwraps a JSON-quoted prose wrapper without using content prefixes for classification", () => {
		const quoted = message({ id: "assistant-quoted", text: '"System: quoted prose"' });

		expect(classifyHermesTranscriptMessage(quoted)).toMatchObject({
			kind: "assistant",
			text: "System: quoted prose",
		});
		expect(projectHermesTranscript([quoted])[0]).toMatchObject({
			kind: "message",
			text: "System: quoted prose",
		});
	});

	test("defines overflow containment for the canvas while isolating technical horizontal scroll", () => {
		const pathological = `https://example.invalid/${"x".repeat(4_096)}`;
		const projected = projectHermesTranscript([message({ id: "long", text: pathological })]);

		expect(projected[0]).toMatchObject({ text: pathological });
		expect(HERMES_CHAT_OVERFLOW_CLASSES.ancestor).toContain("min-w-0");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner).toContain("overflow-x-hidden");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent).toContain("overflow-wrap:anywhere");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.technicalDetail).toContain("overflow-x-auto");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner).not.toContain("overflow-x-auto");
	});

	test("shows current live tools as one activity group and drops them after durable reconciliation", () => {
		const current = {
			...createHermesLiveState(),
			running: true,
			tools: [
				{
					id: "rpc-1",
					turnId: "turn-live",
					name: "read_file",
					status: "complete" as const,
				},
				{
					id: "rpc-2",
					turnId: "turn-live",
					name: "terminal",
					status: "running" as const,
				},
			],
		};

		expect(projectHermesLiveActivity(current)).toMatchObject({
			kind: "activity",
			id: "activity:live:rpc-1",
			status: "running",
			summary: "Running 2 actions",
		});
		expect(projectHermesLiveActivity({ ...current, running: false })).toBeNull();
		expect(
			projectHermesLiveActivity(current, [
				message({
					id: "durable-tool-1",
					turnId: "turn-live",
					role: "tool",
					toolName: "read_file",
					text: "result",
				}),
			])
		).toMatchObject({
			messages: [{ id: "rpc-2", toolName: "terminal" }],
			summary: "Running 1 action",
		});
	});

	test("keeps a completed live reply visible only until canonical history reconciles it", () => {
		const completed = [{ turnId: "turn-live", text: "Finished live reply" }];

		expect(projectHermesLiveCompletions([], completed)).toEqual([
			expect.objectContaining({
				kind: "message",
				id: "assistant:live-complete:turn-live",
				text: "Finished live reply",
			}),
		]);
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical", turnId: "turn-live", text: "Finished live reply" })],
				completed
			)
		).toEqual([]);
	});

	test("adds multiple opaque attachments and removes one before send", () => {
		const initial = reduceHermesComposerAttachments([], {
			type: "add",
			attachments: [
				{
					handle: "opaque-image",
					name: "screen.png",
					size: 3,
					mimeType: "image/png",
					kind: "image",
					expiresAt: 10,
				},
				{
					handle: "opaque-file",
					name: "notes.txt",
					size: 5,
					mimeType: "text/plain",
					kind: "file",
					expiresAt: 10,
				},
			],
		});

		expect(initial.map((attachment) => attachment.status)).toEqual(["ready", "ready"]);
		expect(
			reduceHermesComposerAttachments(initial, { type: "remove", handle: "opaque-image" })
		).toEqual([expect.objectContaining({ handle: "opaque-file" })]);
	});

	test("retains selected attachments with an error for retry and clears only on success", () => {
		const ready = reduceHermesComposerAttachments([], {
			type: "add",
			attachments: [
				{
					handle: "opaque-file",
					name: "notes.txt",
					size: 5,
					mimeType: "text/plain",
					kind: "file",
					expiresAt: 10,
				},
			],
		});
		const attaching = reduceHermesComposerAttachments(ready, { type: "submitting" });
		const failed = reduceHermesComposerAttachments(attaching, {
			type: "failed",
			error: "Hermes could not attach the file",
		});

		expect(failed).toEqual([
			expect.objectContaining({
				handle: "opaque-file",
				status: "error",
				error: "Hermes could not attach the file",
			}),
		]);
		expect(reduceHermesComposerAttachments(failed, { type: "succeeded" })).toEqual([]);
	});

	test("presents submitted attachment metadata as chips without wrapper noise", () => {
		const wrapped = [
			"[SuperiorSwarm attachments]",
			'{"kind":"image","name":"screen.png"}',
			'{"kind":"file","name":"notes.txt","ref":"@file:attachments/notes.txt"}',
			"[/SuperiorSwarm attachments]",
			"",
			"Please review these",
		].join("\n");
		const projected = projectHermesTranscript([
			message({ id: "user-attachments", role: "user", text: JSON.stringify(wrapped) }),
		]);

		expect(projected[0]).toMatchObject({
			kind: "message",
			role: "user",
			text: "Please review these",
			attachments: [
				{
					id: "user-attachments:attachment:0",
					kind: "image",
					name: "screen.png",
					refText: null,
				},
				{
					id: "user-attachments:attachment:1",
					kind: "file",
					name: "notes.txt",
					refText: "@file:attachments/notes.txt",
				},
			],
		});
	});

	test("groups messaging handovers separately while retaining ordinary sessions", () => {
		const local = session({ id: "local", source: "superiorswarm", handover: false });
		const telegram = session({ id: "telegram", source: "telegram", handover: true });
		const custom = session({ id: "custom", source: "custom_adapter", handover: true });

		expect(groupHermesSessions([local, telegram, custom])).toEqual({
			handovers: [telegram, custom],
			sessions: [local],
		});
	});

	test("builds ticket topics only from tickets with existing selectable workspace links", () => {
		expect(
			buildHermesTicketChoices(
				{
					jiraIssues: [
						{ key: "SUP-42", summary: "Fix the release build" },
						{ key: "SUP-99", summary: "Unlinked issue" },
					],
					linearIssues: [{ id: "linear-1", identifier: "ENG-7", title: "Audit retries" }],
				},
				[
					{ provider: "jira", ticketId: "SUP-42", workspaceId: "workspace-jira" },
					{ provider: "linear", ticketId: "linear-1", workspaceId: "workspace-missing" },
				],
				[
					{
						id: "workspace-jira",
						projectName: "SuperiorSwarm",
						name: "SUP-42",
						branch: "feat/sup-42",
					},
				]
			)
		).toEqual([
			{
				value: "jira:SUP-42:workspace-jira",
				topic: "SUP-42: Fix the release build",
				workspaceId: "workspace-jira",
				label: "SUP-42: Fix the release build · SuperiorSwarm / feat/sup-42",
			},
		]);
	});

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

	test("reconciles selected-session busy state from authoritative reconnect bindings", () => {
		const idleReconnect = event("runtime.history-refresh-required", {
			runtimeSessionId: null,
			durableSessionId: null,
			status: "reconnected",
			payload: {
				bindings: [
					{
						hermesSessionId: "session-1",
						durableSessionId: "session-1",
						runtimeSessionId: "runtime-2",
						activeTurn: false,
						status: "idle",
					},
				],
			} as HermesRuntimeEvent["payload"],
		});
		const idle = applyHermesEvent(
			{ ...createHermesLiveState(), running: true, runtimeStatus: "streaming" },
			idleReconnect,
			"session-1"
		);
		expect(idle).toMatchObject({
			running: false,
			runtimeStatus: "idle",
			historyRefreshRequired: true,
		});

		const runningReconnect = event("runtime.history-refresh-required", {
			...idleReconnect,
			payload: {
				bindings: [
					{
						hermesSessionId: "session-1",
						durableSessionId: "session-1",
						runtimeSessionId: "runtime-3",
						activeTurn: true,
						status: "working",
					},
				],
			} as HermesRuntimeEvent["payload"],
		});
		const running = applyHermesEvent(createHermesLiveState(), runningReconnect, "session-1");
		expect(running).toMatchObject({ running: true, runtimeStatus: "working" });
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
				message({
					id: "assistant-tool-wrapper",
					toolName: "terminal",
					text: "This must remain activity",
					createdAt: 200,
				}),
				message({ id: "assistant-failed", status: "failed", createdAt: 300 }),
				message({ id: "assistant-empty-wrapper", text: '"   "', createdAt: 350 }),
				message({ id: "user-1", role: "user", createdAt: 400 }),
			])
		).toMatchObject({ id: "assistant-ok" });
	});

	test("uses only the resolved redacted projection for optional origin actions", () => {
		expect(
			hermesOriginActionAvailability({
				platform: "slack",
				source: "slack",
				displayLabel: "Slack",
				workspaceLabel: null,
				accountLabel: null,
				chatLabel: null,
				channelLabel: null,
				threadLabel: null,
				hasThread: true,
				canOpenThread: true,
				canReport: true,
			})
		).toEqual({ canOpenOrigin: true, canReportToOrigin: true });
		expect(hermesOriginActionAvailability(undefined)).toEqual({
			canOpenOrigin: false,
			canReportToOrigin: false,
		});
	});

	test("requires explicit retry for retryable failed and orphaned-sending receipts", () => {
		expect(hermesReportRequiresExplicitRetry({ status: "failed", retryable: true })).toBe(true);
		expect(hermesReportRequiresExplicitRetry({ status: "sending", retryable: true })).toBe(true);
		expect(hermesReportRequiresExplicitRetry({ status: "sending", retryable: false })).toBe(false);
		expect(hermesReportRequiresExplicitRetry(null)).toBe(false);
	});
});
