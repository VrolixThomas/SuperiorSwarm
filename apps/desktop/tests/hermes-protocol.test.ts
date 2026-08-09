import { describe, expect, test } from "bun:test";
import {
	extractWorkspaceArtifacts,
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
			title: "Slack handoff",
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
			handover: true,
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

	test("withholds a durable session ID that is ambiguous across profiles", () => {
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

		expect(sessions).toEqual([]);
	});

	test("marks stock messaging sidebar rows as handovers without hiding local sessions", () => {
		const sessions = normalizeHermesSessionList(stockMessagingSidebar, "default");
		const byId = new Map(sessions.map((session) => [session.id, session]));

		expect(byId.get("stored-local")?.handover).toBe(false);
		expect(byId.get("stored-slack")?.handover).toBe(true);
		expect(byId.get("stored-telegram")?.handover).toBe(true);
		expect(byId.get("stored-custom")?.handover).toBe(true);
		expect(JSON.stringify(sessions)).not.toContain("raw-route-id");
		expect(JSON.stringify(sessions)).not.toContain("raw-account-id");
	});

	test("normalizes a stock messages page without custom turn results", () => {
		const page = normalizeHermesMessagePage(stockMessagePage, 500);

		expect(page.durableSessionId).toBe("stored-slack-1-tip");
		expect(page.total).toBe(3);
		expect(page.hasMore).toBe(true);
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
