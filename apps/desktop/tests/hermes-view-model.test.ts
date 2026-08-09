import { describe, expect, test } from "bun:test";
import {
	HERMES_CHAT_OVERFLOW_CLASSES,
	applyHermesEvent,
	buildHermesTicketChoices,
	classifyHermesTranscriptMessage,
	createHermesLiveState,
	deriveHermesCanonicalTimeline,
	filterHermesSessions,
	groupHermesSessions,
	hermesActivitySummary,
	hermesComposerContainsFiles,
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
	canonicalMessageId: null,
	compactionGeneration: null,
	active: null,
	compacted: null,
	displayKind: null,
	displayMetadata: null,
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
	test("deduplicates retained physical copies by canonical identity across compactions", () => {
		const timeline = deriveHermesCanonicalTimeline([
			message({
				id: "physical-original",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 0,
				active: false,
				compacted: true,
				role: "user",
				text: "Original question",
			}),
			message({ id: "answer-original", canonicalMessageId: "canonical-answer" }),
			message({
				id: "summary-one",
				canonicalMessageId: "canonical-summary-one",
				displayKind: "compaction_summary",
				text: "First summary",
			}),
			message({
				id: "physical-copy-one",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 1,
				active: false,
				compacted: true,
				role: "user",
				text: "Copy content must not replace the first row",
			}),
			message({
				id: "summary-two",
				canonicalMessageId: "canonical-summary-two",
				displayKind: "compaction_summary",
				text: "Second summary",
			}),
			message({
				id: "physical-copy-two",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 2,
				active: true,
				compacted: false,
				role: "user",
				text: "Another retained copy",
			}),
			message({ id: "new-tail", canonicalMessageId: "canonical-tail", text: "New tail" }),
		]);

		expect(timeline.map((entry) => entry.id)).toEqual([
			"physical-original",
			"answer-original",
			"summary-one",
			"summary-two",
			"new-tail",
		]);
		expect(timeline[0]).toMatchObject({
			text: "Original question",
			physicalRows: [
				{ id: "physical-original", active: false, compacted: true, compactionGeneration: 0 },
				{ id: "physical-copy-one", active: false, compacted: true, compactionGeneration: 1 },
				{ id: "physical-copy-two", active: true, compacted: false, compactionGeneration: 2 },
			],
		});
	});

	test("keeps same-content physical rows distinct when canonical identity is absent", () => {
		const timeline = deriveHermesCanonicalTimeline([
			message({ id: "same-one", canonicalMessageId: null, text: "Repeated" }),
			message({ id: "same-two", canonicalMessageId: null, text: "Repeated" }),
		]);

		expect(timeline.map((entry) => entry.id)).toEqual(["same-one", "same-two"]);
		expect(timeline.map((entry) => entry.physicalRows)).toEqual([
			[expect.objectContaining({ id: "same-one" })],
			[expect.objectContaining({ id: "same-two" })],
		]);
	});

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

	test("preserves JSON-looking quoted prose without using content prefixes for classification", () => {
		const quoted = message({ id: "assistant-quoted", text: '"System: quoted prose"' });

		expect(classifyHermesTranscriptMessage(quoted)).toMatchObject({
			kind: "assistant",
			text: '"System: quoted prose"',
		});
		expect(projectHermesTranscript([quoted])[0]).toMatchObject({
			kind: "message",
			text: '"System: quoted prose"',
		});
	});

	test("classifies only structural display metadata as ordered compaction events", () => {
		const firstSummary = message({
			id: "summary-one",
			role: "user",
			text: "First compacted context",
			compactionGeneration: 1,
			displayKind: "compaction_summary",
			displayMetadata: {
				compaction: { generation: 1, summary_type: "standalone" },
			},
		});
		const secondSummary = message({
			id: "summary-two",
			text: "Second compacted context",
			compactionGeneration: 2,
			displayKind: "compaction_summary",
			displayMetadata: {
				compaction: { generation: 2, summary_type: "incremental" },
			},
		});
		const prefixOnly = message({
			id: "prefix-only",
			text: "Summary of the conversation so far: ordinary assistant prose",
		});

		expect(classifyHermesTranscriptMessage(firstSummary)).toMatchObject({
			kind: "compaction",
			text: "First compacted context",
		});
		expect(classifyHermesTranscriptMessage(prefixOnly).kind).toBe("assistant");
		expect(
			projectHermesTranscript([
				message({ id: "before", role: "user", text: "Before" }),
				firstSummary,
				message({ id: "between", text: "Between" }),
				secondSummary,
				prefixOnly,
			]).map((item) => [item.kind, item.id])
		).toEqual([
			["message", "user:before"],
			["compaction", "compaction:summary-one"],
			["message", "assistant:between"],
			["compaction", "compaction:summary-two"],
			["message", "assistant:prefix-only"],
		]);
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
		const completed = [
			{ turnId: "turn-live", text: "Finished live reply", canonicalMessageIds: [] },
		];

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

	test("reconciles refreshed canonical prose with a missing or different turn ID", () => {
		const completed = [
			{ turnId: "turn-live", text: "Authoritative reply", canonicalMessageIds: ["before"] },
		];

		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-missing", turnId: null, text: "Authoritative reply" })],
				completed
			)
		).toEqual([]);
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-different", turnId: "turn-stock", text: "Authoritative reply" })],
				completed
			)
		).toEqual([]);
	});

	test("does not hide distinct same-text turns and consumes canonical fallbacks once", () => {
		const oldCanonical = message({ id: "canonical-old", turnId: "turn-old", text: "Same reply" });
		const distinct = [
			{
				turnId: "turn-new",
				text: "Same reply",
				canonicalMessageIds: ["canonical-old"],
			},
		];
		expect(projectHermesLiveCompletions([oldCanonical], distinct)).toEqual([
			expect.objectContaining({ id: "assistant:live-complete:turn-new" }),
		]);

		const repeated = [
			{ turnId: "turn-a", text: "Same reply", canonicalMessageIds: [] },
			{ turnId: "turn-b", text: "Same reply", canonicalMessageIds: [] },
		];
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-one", turnId: "turn-stock", text: "Same reply" })],
				repeated
			)
		).toEqual([expect.objectContaining({ id: "assistant:live-complete:turn-b" })]);
	});

	test("keeps a live reply when durable refresh reveals an equivalent archived physical row", () => {
		const refreshed = deriveHermesCanonicalTimeline([
			message({
				id: "archived-origin",
				canonicalMessageId: "canonical-old-reply",
				active: false,
				compacted: true,
				turnId: "turn-old",
				text: "Same reply",
			}),
			message({
				id: "retained-active-copy",
				canonicalMessageId: "canonical-old-reply",
				active: true,
				compacted: false,
				turnId: "turn-old",
				text: "Same reply",
			}),
			message({
				id: "summary-after-old-reply",
				canonicalMessageId: "canonical-summary",
				displayKind: "compaction_summary",
				text: "Earlier context",
			}),
		]);

		const pending = projectHermesLiveCompletions(refreshed, [
			{
				turnId: "turn-new",
				text: "Same reply",
				canonicalMessageIds: ["retained-active-copy"],
			},
		]);

		expect(refreshed.map((entry) => entry.id)).toEqual([
			"archived-origin",
			"summary-after-old-reply",
		]);
		expect(pending).toEqual([expect.objectContaining({ id: "assistant:live-complete:turn-new" })]);
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
		const submitting = reduceHermesComposerAttachments(initial, { type: "submitting" });
		expect(
			reduceHermesComposerAttachments(submitting, { type: "remove", handle: "opaque-image" })
		).toEqual(submitting);
	});

	test("detects dropped and pasted files for the safe paperclip-only composer policy", () => {
		expect(hermesComposerContainsFiles({ types: ["Files"], files: { length: 0 } })).toBe(true);
		expect(hermesComposerContainsFiles({ items: { 0: { kind: "file" }, length: 1 } })).toBe(true);
		expect(hermesComposerContainsFiles({ files: { length: 1 } })).toBe(true);
		expect(hermesComposerContainsFiles({ types: ["text/plain"], files: { length: 0 } })).toBe(
			false
		);
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
			'{"kind":"file","name":"unsafe.txt","ref":"@file:../backend/private.txt"}',
			"[/SuperiorSwarm attachments]",
			"",
			"Please review these",
		].join("\n");
		const projected = projectHermesTranscript([
			message({ id: "user-attachments", role: "user", text: wrapped }),
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
				{
					id: "user-attachments:attachment:2",
					kind: "file",
					name: "unsafe.txt",
					refText: null,
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
		expect(state.completed.at(-1)).toEqual({
			turnId: "turn-1",
			text: "Hello world",
			canonicalMessageIds: [],
		});
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
				message({ id: "assistant-empty", text: "   ", createdAt: 350 }),
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
