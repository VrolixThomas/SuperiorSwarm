import { describe, expect, test } from "bun:test";
import {
	extractWorkspaceArtifacts,
	normalizeHermesActiveTurnSnapshot,
	normalizeHermesEvent,
	normalizeHermesMessagePage,
	normalizeHermesRuntimeActivity,
	normalizeHermesSessionBinding,
	normalizeHermesSessionList,
	sanitizeHermesPayload,
} from "../src/main/hermes/hermes-protocol";
import type { HermesWorkspaceArtifact } from "../src/shared/hermes";
import { stockMessagePage, stockMessagingSidebar, stockSessionList } from "./fixtures/hermes-stock";

describe("stock Hermes protocol adapter", () => {
	test("normalizes stock cross-profile session rows and preserves durable identity", () => {
		const sessions = normalizeHermesSessionList(stockSessionList, "default");

		expect(sessions).toHaveLength(2);
		expect(sessions[0]).toEqual({
			id: "stored-slack-1",
			lineageRootId: "stored-slack-1",
			activeTipId: "stored-slack-1",
			title: "Slack handoff",
			generatedTitle: "Slack handoff",
			titleSource: "generated",
			tags: [],
			metadataRevision: 0,
			preview: "Continue the release plan",
			profileId: "work",
			source: "slack",
			updatedAt: Date.parse("2026-08-09T10:30:00.000Z"),
			createdAt: Date.parse("2026-08-09T08:00:00.000Z"),
			archived: false,
			running: false,
			busy: false,
			waitingForUser: false,
			messageCount: 4,
			isCron: false,
			handover: false,
			admissionReason: null,
			origin: {
				platform: "slack",
				source: "slack",
				displayLabel: "Slack",
				workspaceLabel: null,
				accountLabel: null,
				chatLabel: null,
				channelLabel: null,
				threadLabel: null,
				hasThread: true,
				canOpenThread: false,
				canReport: false,
			},
		});
		expect(sessions[1]?.id).toBe("stored-local-1");
		expect(sessions[1]?.profileId).toBe("default");
		expect(sessions[1]?.updatedAt).toBe(1_786_280_400_000);
		expect(sessions[1]?.archived).toBe(true);

		const rendererJson = JSON.stringify(sessions);
		expect(rendererJson).not.toContain("session_key");
		expect(rendererJson).not.toContain("C01234567");
		expect(rendererJson).not.toContain("U01234567");
	});

	test("retains the same durable session ID in different profiles", () => {
		const sessions = normalizeHermesSessionList(
			{
				recents: {
					sessions: [{ id: "duplicate", profile: "work", title: "Work copy", last_active: 20 }],
				},
				messaging: {
					sessions: [
						{ id: "duplicate", profile: "personal", title: "Personal copy", last_active: 30 },
					],
				},
			},
			"default"
		);

		expect(sessions.map(({ id, profileId, title }) => ({ id, profileId, title }))).toEqual([
			{ id: "duplicate", profileId: "work", title: "Work copy" },
			{ id: "duplicate", profileId: "personal", title: "Personal copy" },
		]);
	});

	test("dedupes repeated rows of the same composite session identity deterministically", () => {
		const sessions = normalizeHermesSessionList(
			{
				recents: {
					sessions: [
						{ id: "duplicate", profile: "work", title: "Older", last_active: 20 },
						{ id: "duplicate", profile: "work", title: "Newest first", last_active: 30 },
					],
				},
				messaging: {
					sessions: [{ id: "duplicate", profile: "work", title: "Newest last", last_active: 30 }],
				},
			},
			"default"
		);

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				id: "duplicate",
				profileId: "work",
				title: "Newest last",
				updatedAt: 30_000,
			})
		);
	});

	test("preserves messaging provenance without treating every messaging row as a handover", () => {
		const sessions = normalizeHermesSessionList(stockMessagingSidebar, "default");
		const byId = new Map(sessions.map((session) => [session.id, session]));

		expect(byId.get("stored-local")?.handover).toBe(false);
		expect(byId.get("stored-slack")?.handover).toBe(false);
		expect(byId.get("stored-telegram")?.handover).toBe(false);
		expect(byId.get("stored-custom")?.handover).toBe(false);
		expect(byId.get("stored-slack")?.origin?.displayLabel).toBe("#release");
		expect(byId.get("stored-telegram")?.origin?.displayLabel).toBe("Ops room");
		expect(JSON.stringify(sessions)).not.toContain("raw-route-id");
		expect(JSON.stringify(sessions)).not.toContain("raw-account-id");
	});

	test("prefers the canonical stored durable ID over a runtime/session alias", () => {
		const [canonical] = normalizeHermesSessionList(
			{
				sessions: [
					{
						id: "runtime-or-tip-alias",
						stored_session_id: "durable-root",
						profile: "work",
						source: "superiorswarm",
					},
				],
			},
			"default"
		);

		expect(canonical?.id).toBe("durable-root");
		expect(canonical?.profileId).toBe("work");
	});

	test("preserves the stock lineage root while exposing the current continuation tip", () => {
		const sessions = normalizeHermesSessionList(
			{
				sessions: [
					{
						id: "continuation-child",
						_lineage_root_id: "conversation-root",
						profile: "work",
						title: "Continued conversation",
						last_active: 30,
					},
				],
			},
			"default"
		);

		expect(sessions).toEqual([
			expect.objectContaining({
				id: "continuation-child",
				activeTipId: "continuation-child",
				lineageRootId: "conversation-root",
				profileId: "work",
			}),
		]);
	});

	test("dedupes rotated continuation tips by lineage root and keeps the newest tip", () => {
		const sessions = normalizeHermesSessionList(
			{
				sessions: [
					{
						id: "older-child",
						_lineage_root_id: "conversation-root",
						profile: "work",
						last_active: 20,
					},
					{
						id: "current-child",
						_lineage_root_id: "conversation-root",
						profile: "work",
						last_active: 30,
					},
				],
			},
			"default"
		);

		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toEqual(
			expect.objectContaining({
				id: "current-child",
				activeTipId: "current-child",
				lineageRootId: "conversation-root",
			})
		);
	});

	test("normalizes a stock messages page without custom turn results", () => {
		const page = normalizeHermesMessagePage(stockMessagePage, 500);

		expect(page.durableSessionId).toBe("stored-slack-1-tip");
		expect(page.total).toBe(3);
		expect(page.hasMore).toBe(true);
		expect(page.messageIdsAreStable).toBe(true);
		expect(page.messages).toEqual([
			expect.objectContaining({ id: "message-3", role: "assistant", text: "Done" }),
			expect.objectContaining({
				id: "message-2",
				role: "tool",
				text: "Tests passed",
				toolName: "terminal",
			}),
		]);
		expect("turnResults" in page).toBe(false);
	});

	test("marks positional fallback message IDs as unstable continuity metadata", () => {
		const page = normalizeHermesMessagePage(
			{
				session_id: "durable-session",
				messages: [
					{ role: "user", content: "First" },
					{ id: "physical-2", role: "assistant", content: "Second" },
				],
			},
			500
		);

		expect(page.messages.map((entry) => entry.id)).toEqual(["history-0", "physical-2"]);
		expect(page.messageIdsAreStable).toBe(false);
	});

	test("rejects invalid pagination counts and uses normalized message length as returned", () => {
		for (const pagination of [
			{ limit: -1 },
			{ offset: -1 },
			{ returned: 1.5 },
			{ total: Number.POSITIVE_INFINITY },
			{ offset: "tomorrow" },
		]) {
			expect(() =>
				normalizeHermesMessagePage(
					{
						session_id: "durable-session",
						messages: [],
						pagination,
					},
					500
				)
			).toThrow("pagination");
		}
		expect(() =>
			normalizeHermesMessagePage(
				{
					session_id: "durable-session",
					messages: [],
					returned: -1,
				},
				500
			)
		).toThrow("pagination");

		const page = normalizeHermesMessagePage(
			{
				session_id: "durable-session",
				messages: [{ id: "only-row", role: "assistant", content: "Done" }],
				pagination: { offset: 0, returned: 500, has_more: true },
			},
			500
		);
		expect(page.returned).toBe(1);
	});

	test("projects only allowlisted durable display fields across the renderer boundary", () => {
		const page = normalizeHermesMessagePage(
			{
				session_id: "durable-session",
				view: "durable",
				messages: [
					{
						id: 91,
						canonical_message_id: 7,
						compaction_generation: 2,
						active: false,
						compacted: true,
						display_kind: "compaction_summary",
						display_metadata: {
							compaction: {
								generation: 2,
								summary_type: "standalone",
								raw: "nested-innocent-key-secret",
							},
							raw: { opaque: "raw-innocent-key-secret" },
							harmless: "arbitrary-innocent-key-secret",
							token: "must-not-reach-renderer",
						},
						role: "user",
						content: "Structural summary",
						timestamp: 1_786_291_200,
					},
				],
			},
			500
		);

		expect(page.messages[0]).toEqual(
			expect.objectContaining({
				id: "91",
				canonicalMessageId: "7",
				compactionGeneration: 2,
				active: false,
				compacted: true,
				displayKind: "compaction_summary",
				compactionSummaryType: "standalone",
				role: "user",
				text: "Structural summary",
			})
		);
		const rendererJson = JSON.stringify(page.messages[0]);
		expect(rendererJson).not.toContain("displayMetadata");
		expect(rendererJson).not.toContain("innocent-key-secret");
		expect(rendererJson).not.toContain("must-not-reach");
	});

	test("normalizes zero-valued numeric and string transcript identities", () => {
		const page = normalizeHermesMessagePage(
			{
				session_id: "durable-session",
				messages: [
					{ id: 0, role: "user", content: "Original" },
					{ id: "copy", canonical_message_id: 0, role: "user", content: "Numeric copy" },
					{
						id: "string-copy",
						canonical_message_id: "0",
						role: "user",
						content: "String copy",
					},
				],
			},
			500
		);

		expect(page.messages.map(({ id, canonicalMessageId }) => [id, canonicalMessageId])).toEqual([
			["0", null],
			["copy", "0"],
			["string-copy", "0"],
		]);
	});

	test("rejects unknown compaction summary types instead of forwarding opaque strings", () => {
		const page = normalizeHermesMessagePage(
			{
				session_id: "durable-session",
				messages: [
					{
						id: "summary",
						display_kind: "compaction_summary",
						display_metadata: {
							compaction: { summary_type: "private-backend-shape-secret" },
						},
						role: "assistant",
						content: "Summary",
					},
				],
			},
			500
		);

		expect(page.messages[0]?.compactionSummaryType).toBeNull();
		expect(JSON.stringify(page.messages[0])).not.toContain("private-backend-shape-secret");
	});

	test("keeps stock runtime and durable session identities distinct", () => {
		const created = normalizeHermesSessionBinding({
			session_id: "runtime-created",
			stored_session_id: "stored-created",
			profile: "work",
		});
		const resumed = normalizeHermesSessionBinding(
			{ session_id: "runtime-resumed", session_key: "stored-existing" },
			"stored-existing",
			"work"
		);

		expect(created).toEqual({
			runtimeSessionId: "runtime-created",
			durableSessionId: "stored-created",
			profileId: "work",
			persisted: false,
		});
		expect(resumed).toEqual({
			runtimeSessionId: "runtime-resumed",
			durableSessionId: "stored-existing",
			profileId: "work",
			persisted: true,
		});
		expect("claimId" in created).toBe(false);
		expect("bindingGeneration" in resumed).toBe(false);
	});

	test("normalizes authoritative stock running and status fields", () => {
		expect(normalizeHermesRuntimeActivity({ running: false, status: "idle" })).toEqual({
			activeTurn: false,
			status: "idle",
		});
		expect(normalizeHermesRuntimeActivity({ running: true, status: "working" })).toEqual({
			activeTurn: true,
			status: "working",
		});
	});

	test("hydrates stock inflight and queued resume projections without turn IDs", () => {
		const snapshot = normalizeHermesActiveTurnSnapshot(
			{
				messages: [],
				inflight: {
					user: "current prompt",
					assistant: "partial answer continued",
					corrections: ["steer toward tests"],
					correction_offsets: [14],
					streaming: true,
				},
				queued: { user: "next prompt" },
			},
			{
				durableSessionId: "stored-1",
				runtimeSessionId: "runtime-1",
				profileId: "work",
				eventSeq: 7,
				activeTurn: true,
				status: "streaming",
			}
		);

		expect(snapshot).toMatchObject({
			turnId: null,
			inflightUser: {
				id: "stock-inflight:stored-1",
				profileId: "work",
				text: "current prompt",
				status: "accepted",
			},
			corrections: [
				{
					id: "stock-inflight-correction:stored-1:0",
					text: "steer toward tests",
					assistantTextBefore: "partial answer",
				},
			],
			streamingText: " continued",
			queuedFollowUps: [{ id: "stock-queued:stored-1", text: "next prompt", status: "accepted" }],
		});
	});

	test("places legacy corrections after the full assistant dump when offsets are unavailable", () => {
		const snapshot = normalizeHermesActiveTurnSnapshot(
			{
				messages: [],
				inflight: {
					assistant: "visible before reconnect",
					corrections: ["first correction", "second correction"],
				},
			},
			{
				durableSessionId: "stored-1",
				runtimeSessionId: "runtime-1",
				profileId: "work",
				eventSeq: 8,
				activeTurn: true,
				status: "streaming",
			}
		);

		expect(snapshot.corrections.map((correction) => correction.assistantTextBefore)).toEqual([
			"visible before reconnect",
			"",
		]);
		expect(snapshot.streamingText).toBe("");
	});

	test("interprets correction offsets as Unicode character counts", () => {
		const snapshot = normalizeHermesActiveTurnSnapshot(
			{
				messages: [],
				inflight: {
					assistant: "A😀B",
					corrections: ["after emoji"],
					correction_offsets: [2],
				},
			},
			{
				durableSessionId: "stored-1",
				runtimeSessionId: "runtime-1",
				profileId: "work",
				eventSeq: 9,
				activeTurn: true,
				status: "streaming",
			}
		);

		expect(snapshot.corrections[0]?.assistantTextBefore).toBe("A😀");
		expect(snapshot.streamingText).toBe("B");
	});

	test("normalizes stock event frames by ephemeral runtime ID", () => {
		const event = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: {
				session_id: "runtime-1",
				type: "message.delta",
				payload: { text: "hello", claim_id: "must-not-leak", token: "secret" },
			},
		});

		expect(event).toEqual(
			expect.objectContaining({
				type: "message.delta",
				runtimeSessionId: "runtime-1",
				durableSessionId: null,
				text: "hello",
			})
		);
		expect(JSON.stringify(event)).not.toContain("claim");
		expect(JSON.stringify(event)).not.toContain("secret");
	});

	test("preserves allowlisted native subagent identity and progress without leaking raw payload", () => {
		const event = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: {
				session_id: "runtime-parent",
				type: "subagent.progress",
				payload: {
					subagent_id: "child-1",
					parent_id: "parent-child",
					child_session_id: "durable-child",
					goal: "Investigate the queue",
					model: "hermes-test",
					status: "running",
					task_index: 1,
					task_count: 3,
					depth: 1,
					tool_count: 4,
					files_read: ["gateway/run.py"],
					files_written: ["tests/test_queue.py"],
					text: "checking FIFO",
					token: "must-not-leak",
					origin_json: { chat_id: "must-not-leak" },
				},
			},
		});

		expect(event).toMatchObject({
			type: "subagent.progress",
			runtimeSessionId: "runtime-parent",
			text: "checking FIFO",
			payload: {
				subagent: {
					subagentId: "child-1",
					parentId: "parent-child",
					childSessionId: "durable-child",
					goal: "Investigate the queue",
					status: "running",
					taskIndex: 1,
					taskCount: 3,
					toolCount: 4,
					filesRead: ["gateway/run.py"],
					filesWritten: ["tests/test_queue.py"],
				},
			},
		});
		expect(JSON.stringify(event)).not.toContain("must-not-leak");
	});

	test("rejects malformed stock bindings and sanitizes secret-bearing payloads", () => {
		expect(() => normalizeHermesSessionBinding({ session_id: "runtime-only" })).toThrow(
			"durable session"
		);
		expect(normalizeHermesSessionList({ sessions: [{ token: "secret" }] }, "default")).toEqual([]);
		expect(
			sanitizeHermesPayload({
				message: "failed https://localhost/api/ws?ticket=abc&token=def",
				origin_json: { team_id: "T1" },
				cookie: "session=secret",
			})
		).toEqual({ message: "failed https://localhost/api/ws?ticket=[redacted]&token=[redacted]" });
	});

	test("keeps structured workspace artifacts from trusted stock event/history envelopes", () => {
		const artifact: HermesWorkspaceArtifact = {
			kind: "superiorswarm.workspace.created",
			workspaceId: "workspace-1",
			projectId: "project-1",
			branch: "feat/stock-hermes",
			worktreePath: "/tmp/worktree",
		};

		expect(extractWorkspaceArtifacts({ structuredContent: artifact })).toEqual([artifact]);
		expect(extractWorkspaceArtifacts({ arguments: { structuredContent: artifact } })).toEqual([]);
	});
});
