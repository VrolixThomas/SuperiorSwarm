import { describe, expect, test } from "bun:test";
import {
	HERMES_REQUIRED_CAPABILITIES,
	extractWorkspaceArtifacts,
	normalizeHermesCatalog,
	normalizeHermesEvent,
} from "../src/main/hermes/hermes-protocol";

describe("Hermes protocol adapter", () => {
	test("normalizes the versioned redacted catalog without leaking unknown origin fields", () => {
		const catalog = normalizeHermesCatalog({
			protocol_version: 1,
			capabilities: HERMES_REQUIRED_CAPABILITIES,
			sessions: [
				{
					id: "session-tip",
					lineage_tip_id: "session-tip",
					lineage_root_id: "session-root",
					title: "Fix checkout",
					preview: "Investigating",
					profile: "default",
					source: "slack",
					updated_at: 123,
					created_at: 100,
					open: true,
					archived: false,
					running: false,
					busy: false,
					claimed: true,
					waiting_for_user: true,
					origin_label: "#engineering · thread",
					can_open_origin: true,
					can_report_to_origin: true,
					opaque_origin_ref: "origin_123",
					slack_token: "must-not-cross",
				},
			],
		});

		expect(catalog.compatibility.state).toBe("compatible");
		expect(catalog.sessions[0]).toEqual({
			id: "session-tip",
			lineageTipId: "session-tip",
			lineageRootId: "session-root",
			title: "Fix checkout",
			preview: "Investigating",
			profileId: "default",
			source: "slack",
			updatedAt: 123,
			createdAt: 100,
			open: true,
			archived: false,
			running: false,
			busy: false,
			claimed: true,
			waitingForUser: true,
			originLabel: "#engineering · thread",
			canOpenOrigin: true,
			canReportToOrigin: true,
			opaqueOriginRef: "origin_123",
		});
		expect(JSON.stringify(catalog)).not.toContain("must-not-cross");
	});

	test("fails closed when the Hermes extension is missing required capabilities", () => {
		const catalog = normalizeHermesCatalog({
			protocol_version: 1,
			capabilities: ["session.catalog"],
			sessions: [],
		});

		expect(catalog.compatibility.state).toBe("upgrade-required");
		expect(catalog.compatibility.missingCapabilities).toContain("session.claim");
	});

	test("redacts credentials embedded in catalog display fields", () => {
		const catalog = normalizeHermesCatalog({
			protocol_version: 1,
			capabilities: HERMES_REQUIRED_CAPABILITIES,
			sessions: [
				{
					id: "session-secret",
					title: "Failed ws://localhost/api/ws?token=title-secret",
					preview: "Bearer preview-secret",
					origin_label: "Bearer origin-secret",
				},
			],
		});

		expect(JSON.stringify(catalog)).not.toContain("title-secret");
		expect(JSON.stringify(catalog)).not.toContain("preview-secret");
		expect(JSON.stringify(catalog)).not.toContain("origin-secret");
	});

	test("extracts structured worktree artifacts from live and historical response envelopes", () => {
		const artifact = {
			kind: "superiorswarm.workspace.created" as const,
			workspaceId: "ws-1",
			projectId: "project-1",
			branch: "feat/hermes",
			worktreePath: "/repos/app-worktrees/feat/hermes",
		};
		const payload = {
			tool_result: {
				structuredContent: { artifact },
				content: [{ type: "text", text: JSON.stringify(artifact) }],
			},
		};

		expect(extractWorkspaceArtifacts(payload)).toEqual([artifact]);
		const event = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: { type: "tool.complete", session_id: "runtime-1", payload },
		});
		expect(event?.type).toBe("tool.complete");
		expect(event?.workspaceArtifacts).toEqual([artifact]);
	});

	test("redacts credentials from normalized event text before it reaches the renderer", () => {
		const event = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: {
				type: "runtime.error",
				payload: {
					text: "failed ws://127.0.0.1/api/ws?token=hermes-secret&mode=retry",
					authorization: "Bearer another-secret",
				},
			},
		});

		expect(event?.text).toContain("token=[redacted]");
		expect(JSON.stringify(event)).not.toContain("hermes-secret");
		expect(JSON.stringify(event)).not.toContain("another-secret");
	});
});
