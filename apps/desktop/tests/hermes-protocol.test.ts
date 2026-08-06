import { describe, expect, test } from "bun:test";
import {
	HERMES_REQUIRED_CAPABILITIES,
	extractWorkspaceArtifacts,
	normalizeHermesCatalog,
	normalizeHermesEvent,
	normalizeHermesHistory,
} from "../src/main/hermes/hermes-protocol";

describe("Hermes protocol adapter", () => {
	const advertisedCapabilities = [...HERMES_REQUIRED_CAPABILITIES, "session.tool_artifacts"];
	const protocolInfo = (methods: readonly string[] = advertisedCapabilities, version = 1) => ({
		name: "hermes-serve-jsonrpc",
		version: 1,
		capabilities: {
			session_handoff: {
				version,
				methods: Object.fromEntries(methods.map((method) => [method, 1])),
			},
		},
	});

	test("normalizes the exact Hermes protocol and catalog payloads", () => {
		const catalog = normalizeHermesCatalog(
			{
				protocol_version: 1,
				sessions: [
					{
						session_id: "session-tip",
						lineage_root_id: "session-root",
						current_tip_id: "session-tip",
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
						claim: {
							owner: "superiorswarm:desktop-1",
							client_id: "desktop-1",
							surface: "superiorswarm",
							purpose: "handoff",
							heartbeat_at: 120,
							expires_at: 180,
						},
						origin: {
							platform: "slack",
							label: "#engineering · thread",
							origin_ref: "origin_123",
							can_open_origin: true,
							can_report_to_origin: true,
						},
					},
				],
			},
			protocolInfo()
		);

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
			waitingForUser: false,
			originLabel: "#engineering · thread",
			canOpenOrigin: true,
			canReportToOrigin: true,
			opaqueOriginRef: "origin_123",
		});
		expect(catalog.compatibility.capabilities).toEqual(advertisedCapabilities);
		expect(JSON.stringify(catalog)).not.toContain("desktop-1");
	});

	test("fails closed when the actual Hermes protocol omits a required method", () => {
		const catalog = normalizeHermesCatalog(
			{ protocol_version: 1, sessions: [] },
			protocolInfo(["session.catalog"])
		);

		expect(catalog.compatibility.state).toBe("upgrade-required");
		expect(catalog.compatibility.missingCapabilities).toContain("session.claim");
	});

	test("fails closed when the Hermes handoff protocol version is too old", () => {
		const catalog = normalizeHermesCatalog(
			{ protocol_version: 1, sessions: [] },
			protocolInfo(HERMES_REQUIRED_CAPABILITIES, 0)
		);

		expect(catalog.compatibility.state).toBe("upgrade-required");
	});

	test("redacts credentials embedded in catalog display fields", () => {
		const catalog = normalizeHermesCatalog(
			{
				protocol_version: 1,
				sessions: [
					{
						session_id: "session-secret",
						title: "Failed ws://localhost/api/ws?token=title-secret",
						preview: "Bearer preview-secret",
						origin: { label: "Bearer origin-secret" },
					},
				],
			},
			protocolInfo()
		);

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

	test("constructs a strict renderer event DTO and drops arbitrary tool arguments and results", () => {
		const event = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: {
				type: "tool.complete",
				session_id: "runtime-1",
				payload: {
					request_id: "tool-1",
					tool_name: "deploy",
					status: "complete",
					text: [
						"API_KEY=api-key-secret",
						"Authorization: Basic basic-auth-secret",
						"https://files.example.test/archive?X-Amz-Signature=signed-url-secret&part=1",
					].join("\n"),
					tool_args: { environment: "production", value: "tool-args-secret" },
					result: {
						output: "benign-result-field-secret",
						metadata: { note: "nested-result-secret" },
					},
					artifact: {
						kind: "superiorswarm.workspace.created",
						workspaceId: "workspace-1",
						projectId: "project-1",
						branch: "feat/hermes?token=artifact-url-secret",
						worktreePath: "/repos/app-worktrees/feat/hermes",
						metadata: { credential: "artifact-metadata-secret" },
					},
				},
			},
		});

		expect(event?.payload).toEqual({});
		expect(event?.workspaceArtifacts).toEqual([
			{
				kind: "superiorswarm.workspace.created",
				workspaceId: "workspace-1",
				projectId: "project-1",
				branch: "feat/hermes?token=[redacted]",
				worktreePath: "/repos/app-worktrees/feat/hermes",
			},
		]);
		const serialized = JSON.stringify(event);
		for (const secret of [
			"api-key-secret",
			"basic-auth-secret",
			"signed-url-secret",
			"tool-args-secret",
			"benign-result-field-secret",
			"nested-result-secret",
			"artifact-url-secret",
			"artifact-metadata-secret",
		]) {
			expect(serialized).not.toContain(secret);
		}
	});

	test("normalizes real approval and clarification prompts with choices without exposing secrets", () => {
		const approval = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: {
				type: "approval.request",
				session_id: "runtime-1",
				payload: {
					request_id: "approval-1",
					command: "deploy --api-key command-secret --environment production",
					description: "Deploy the release? token=description-secret",
					choices: [
						{ value: "allow_once", label: "Allow once" },
						{ value: "deny", label: "Deny" },
					],
				},
			},
		});
		const clarification = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: {
				type: "clarify.request",
				payload: {
					request_id: "clarify-1",
					question: "Which environment should use Bearer clarification-secret?",
					choices: ["staging", "production"],
				},
			},
		});

		expect(approval?.text).toBe(
			"Deploy the release? token=[redacted]\n\nCommand:\ndeploy --api-key [redacted] --environment production"
		);
		expect(approval?.payload["choices"]).toEqual([
			{ value: "allow_once", label: "Allow once" },
			{ value: "deny", label: "Deny" },
		]);
		expect(clarification?.text).toBe("Which environment should use [redacted]?");
		expect(JSON.stringify({ approval, clarification })).not.toContain("command-secret");
		expect(JSON.stringify({ approval, clarification })).not.toContain("description-secret");
		expect(JSON.stringify({ approval, clarification })).not.toContain("clarification-secret");
	});

	test("preserves generic interaction fallbacks when Hermes omits a prompt", () => {
		const approval = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: { type: "approval.request", payload: { request_id: "approval-1" } },
		});
		const clarification = normalizeHermesEvent({
			jsonrpc: "2.0",
			method: "event",
			params: { type: "clarify.request", payload: { request_id: "clarify-1" } },
		});

		expect(approval?.text).toBeNull();
		expect(clarification?.text).toBeNull();
	});

	test("normalizes allow-listed durable turn results without forwarding extra result fields", () => {
		const history = normalizeHermesHistory({
			messages: [{ id: "message-1", role: "assistant", text: "Done" }],
			turn_results: [
				{
					turn_id: "turn-1",
					content: "Finished with API_KEY=durable-secret",
					completed_at: 456,
					status: "complete",
					result: { summary: "benign-history-result-secret" },
					extra: "extra-history-secret",
				},
			],
		});

		expect(history.messages).toHaveLength(1);
		expect(history.turnResults).toEqual([
			{
				turnId: "turn-1",
				content: "Finished with API_KEY=[redacted]",
				completedAt: 456,
				status: "complete",
			},
		]);
		expect(JSON.stringify(history)).not.toContain("durable-secret");
		expect(JSON.stringify(history)).not.toContain("benign-history-result-secret");
		expect(JSON.stringify(history)).not.toContain("extra-history-secret");
	});
});
