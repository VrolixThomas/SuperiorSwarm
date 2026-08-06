import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _setDbForTesting, schema } from "../src/main/db";
import { saveHermesConnection } from "../src/main/hermes/hermes-connections";
import { HERMES_REQUIRED_CAPABILITIES } from "../src/main/hermes/hermes-protocol";
import { HermesRpcError } from "../src/main/hermes/hermes-runtime-client";
import {
	type HermesRuntimeClientLike,
	HermesRuntimeService,
} from "../src/main/hermes/hermes-runtime-service";
import { HermesTokenVault } from "../src/main/hermes/hermes-token-vault";
import {
	listHermesWorkspaceLinks,
	unlinkHermesWorkspace,
} from "../src/main/hermes/hermes-workspace-links";
import type { HermesRuntimeEvent, HermesRuntimeState } from "../src/shared/hermes";
import { makeTestDb } from "./test-db";

class FakeClient implements HermesRuntimeClientLike {
	capabilities: readonly string[] = HERMES_REQUIRED_CAPABILITIES;
	handoffProtocolVersion = 1;
	catalogSessionId = "session-tip";
	catalogLineageTipId = "session-tip";
	resumeStoredSessionId = "session-tip";
	failHistory = false;
	failReport = false;
	catalogMethodMissing = false;
	failToolArtifacts = false;
	requests: Array<{ method: string; params: Record<string, unknown> }> = [];
	eventListener: ((event: HermesRuntimeEvent) => void) | null = null;
	stateListener: ((state: HermesRuntimeState) => void) | null = null;
	state: HermesRuntimeState = {
		status: "disconnected",
		reconnectAttempt: 0,
		lastConnectedAt: null,
		error: null,
	};

	async connect(): Promise<void> {
		this.state = { ...this.state, status: "connected", lastConnectedAt: Date.now() };
		this.stateListener?.(this.state);
	}

	disconnect(): void {
		this.state = { ...this.state, status: "disconnected" };
	}

	getState(): HermesRuntimeState {
		return this.state;
	}

	subscribe(listener: (event: HermesRuntimeEvent) => void): () => void {
		this.eventListener = listener;
		return () => {
			this.eventListener = null;
		};
	}

	subscribeState(listener: (state: HermesRuntimeState) => void): () => void {
		this.stateListener = listener;
		return () => {
			this.stateListener = null;
		};
	}

	async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.requests.push({ method, params });
		switch (method) {
			case "protocol.info":
				return {
					name: "hermes-serve-jsonrpc",
					version: 1,
					capabilities: {
						session_handoff: {
							version: this.handoffProtocolVersion,
							methods: Object.fromEntries(this.capabilities.map((capability) => [capability, 1])),
						},
					},
				};
			case "session.catalog":
				if (this.catalogMethodMissing) {
					throw new HermesRpcError("Method not found", -32601, false);
				}
				return {
					protocol_version: 1,
					sessions: [
						{
							session_id: this.catalogSessionId,
							lineage_root_id: "session-root",
							current_tip_id: this.catalogLineageTipId,
							title: "Slack task",
							preview: "Please fix the handoff",
							profile: "default",
							source: "slack",
							created_at: 100,
							updated_at: 200,
							open: true,
							archived: false,
							running: false,
							busy: false,
							claimed: false,
							claim: null,
							origin: {
								platform: "slack",
								label: "Slack thread?token=origin-secret",
								origin_ref: "origin_123",
								can_open_origin: true,
								can_report_to_origin: true,
							},
						},
					],
				};
			case "session.claim":
				return {
					claim: {
						claim_id: "claim-1",
						session_id: "session-tip",
						lineage_root_id: "session-root",
						owner: "superiorswarm:desktop-1",
						client_id: "desktop-1",
						surface: "superiorswarm",
						purpose: "handoff",
						heartbeat_at: 200,
						expires_at: 260,
					},
				};
			case "session.resume":
				return {
					session_id: "runtime-1",
					resumed: this.resumeStoredSessionId,
					session_key: this.resumeStoredSessionId,
					message_count: 1,
					messages: [],
					status: "idle",
				};
			case "session.history":
				if (this.failHistory) throw new Error("history unavailable");
				return {
					messages: [
						{
							id: "message-1",
							role: "assistant",
							text: "Created workspace",
							structuredContent: {
								kind: "superiorswarm.workspace.created",
								workspaceId: "workspace-1",
								projectId: "project-1",
								branch: "feat/hermes",
								worktreePath: "/repos/app-worktrees/feat/hermes",
							},
						},
					],
				};
			case "session.tool_artifacts":
				if (this.failToolArtifacts) throw new Error("artifact projection unavailable");
				return { artifacts: [] };
			case "prompt.submit":
				return { status: "streaming", turn_id: "turn-1" };
			case "session.origin":
				return {
					session_id: "session-tip",
					lineage_root_id: "session-root",
					origin: {
						platform: "slack",
						label: "Slack thread?token=origin-secret",
						origin_ref: "origin_123",
						can_open_origin: true,
						can_report_to_origin: true,
						deep_link: "https://slack.com/archives/thread",
					},
				};
			case "session.report_to_origin":
				if (this.failReport) throw new Error("connection closed");
				return {
					status: "sent",
					message_id: "slack-message-1",
					permalink: "https://slack.com/archives/thread",
				};
			case "session.release":
				return { released: true };
			default:
				return { ok: true };
		}
	}
}

describe("HermesRuntimeService", () => {
	let db: ReturnType<typeof makeTestDb>;
	let vault: HermesTokenVault;
	let client: FakeClient;
	let service: HermesRuntimeService;
	let connectionId: string;

	beforeEach(() => {
		db = makeTestDb();
		_setDbForTesting(db);
		vault = new HermesTokenVault({
			isEncryptionAvailable: () => false,
			encryptString: () => Buffer.alloc(0),
			decryptString: () => "",
		});
		connectionId = saveHermesConnection(
			{
				label: "Local",
				baseUrl: "http://127.0.0.1:8080",
				profileId: "default",
				token: "runtime-secret",
			},
			vault
		).id;

		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: "project-1",
				name: "App",
				repoPath: "/repos/app",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.worktrees)
			.values({
				id: "worktree-1",
				projectId: "project-1",
				path: "/repos/app-worktrees/feat/hermes",
				branch: "feat/hermes",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.workspaces)
			.values({
				id: "workspace-1",
				projectId: "project-1",
				type: "worktree",
				name: "feat/hermes",
				worktreeId: "worktree-1",
				createdAt: now,
				updatedAt: now,
			})
			.run();

		client = new FakeClient();
		service = new HermesRuntimeService({ clientFactory: () => client, tokenVault: vault });
	});

	afterEach(() => {
		service.shutdown();
		_setDbForTesting(null);
	});

	test("negotiates capabilities, claims before resume, refreshes history, and backfills artifacts", async () => {
		const catalog = await service.connect(connectionId);
		expect(catalog.compatibility.state).toBe("compatible");

		const resumed = await service.resume(connectionId, "session-tip");
		expect(resumed.runtimeSessionId).toBe("runtime-1");
		expect(resumed.history[0]?.text).toBe("Created workspace");
		expect(client.requests.map((request) => request.method).slice(0, 5)).toEqual([
			"protocol.info",
			"session.catalog",
			"session.claim",
			"session.resume",
			"session.history",
		]);
		const claim = client.requests.find((request) => request.method === "session.claim");
		expect(claim?.params["ttl_seconds"]).toBe(60);
		expect(claim?.params).not.toHaveProperty("ttl");
		expect(listHermesWorkspaceLinks(connectionId, "session-tip")).toHaveLength(1);
	});

	test("presents the handoff claim on session mutations and releases it", async () => {
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");
		await service.submit(connectionId, "session-tip", "Continue");
		await service.interrupt(connectionId, "session-tip");
		await service.respondToApproval({
			connectionId,
			hermesSessionId: "session-tip",
			requestId: "approval-1",
			choice: "allow",
		});
		await service.respondToClarification({
			connectionId,
			hermesSessionId: "session-tip",
			requestId: "clarify-1",
			answer: "Use the existing branch",
		});
		const report = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-1",
			content: "Done",
		});
		expect(report.status).toBe("sent");
		expect(report.permalink).toBe("https://slack.com/archives/thread");
		const repeatedReport = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-1",
			content: "Done",
		});
		expect(repeatedReport.status).toBe("sent");
		expect(
			client.requests.filter((request) => request.method === "session.report_to_origin")
		).toHaveLength(1);

		await service.release(connectionId, "session-tip");
		const submit = client.requests.find((request) => request.method === "prompt.submit");
		expect(submit?.params["session_id"]).toBe("runtime-1");
		for (const method of [
			"prompt.submit",
			"session.interrupt",
			"approval.respond",
			"clarify.respond",
		]) {
			const request = client.requests.find((candidate) => candidate.method === method);
			expect(request?.params["claim_id"]).toBe("claim-1");
		}
		const release = client.requests.find((request) => request.method === "session.release");
		expect(release?.params["claim_id"]).toBe("claim-1");
	});

	test("publishes redacted ordered events through a cursor feed", async () => {
		await service.connect(connectionId);
		client.eventListener?.({
			type: "message.delta",
			sessionId: "runtime-1",
			turnId: "turn-1",
			requestId: null,
			text: "hello",
			toolName: null,
			status: null,
			payload: {},
			workspaceArtifacts: [],
			receivedAt: 1,
		});
		const feed = service.events(connectionId, 0);
		expect(feed.events.at(-1)?.event.type).toBe("message.delta");
		expect(feed.nextSeq).toBeGreaterThan(0);
	});

	test("persists structured worktree artifacts arriving in the live event stream", async () => {
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");
		unlinkHermesWorkspace(connectionId, "session-tip", "workspace-1");
		expect(listHermesWorkspaceLinks(connectionId, "session-tip")).toEqual([]);

		client.eventListener?.({
			type: "tool.complete",
			sessionId: "runtime-1",
			turnId: "turn-live",
			requestId: "tool-live",
			text: null,
			toolName: "create_worktree",
			status: "complete",
			payload: {},
			workspaceArtifacts: [
				{
					kind: "superiorswarm.workspace.created",
					workspaceId: "workspace-1",
					projectId: "project-1",
					branch: "feat/hermes",
					worktreePath: "/repos/app-worktrees/feat/hermes",
				},
			],
			receivedAt: 2,
		});

		expect(listHermesWorkspaceLinks(connectionId, "session-tip")).toHaveLength(1);
	});

	test("resolves origin and reports against the current lineage tip", async () => {
		client.catalogSessionId = "session-canonical";
		client.catalogLineageTipId = "session-tip";
		client.resumeStoredSessionId = "session-new-tip";
		await service.connect(connectionId);
		await service.resume(connectionId, "session-canonical");
		const originInfo = await service.origin(connectionId, "session-canonical");
		await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-canonical",
			turnId: "turn-tip",
			content: "Finished",
		});

		const origin = client.requests.find((request) => request.method === "session.origin");
		const report = client.requests.find((request) => request.method === "session.report_to_origin");
		expect(origin?.params["session_id"]).toBe("session-new-tip");
		expect(report?.params["session_id"]).toBe("session-new-tip");
		expect(originInfo).toEqual({
			displayLabel: "Slack thread?token=[redacted]",
			canOpen: true,
			canReport: true,
			permalink: "https://slack.com/archives/thread",
		});
		expect(originInfo.displayLabel).not.toContain("origin-secret");
	});

	test("cleans up a claim and binding when canonical history refresh fails", async () => {
		await service.connect(connectionId);
		client.failHistory = true;
		await expect(service.resume(connectionId, "session-tip")).rejects.toThrow(
			"history unavailable"
		);
		client.failHistory = false;
		await service.resume(connectionId, "session-tip");

		expect(client.requests.filter((request) => request.method === "session.claim")).toHaveLength(2);
		expect(client.requests.filter((request) => request.method === "session.release")).toHaveLength(
			1
		);
	});

	test("persists transport report failures as retryable", async () => {
		await service.connect(connectionId);
		client.failReport = true;
		const report = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-network-failure",
			content: "Finished",
		});

		expect(report.status).toBe("failed");
		expect(report.retryable).toBe(true);
	});

	test("fails closed with an upgrade-required state when capabilities are missing", async () => {
		client.capabilities = ["session.catalog"];
		const catalog = await service.connect(connectionId);

		expect(catalog.compatibility.state).toBe("upgrade-required");
		expect(service.getState(connectionId).status).toBe("upgrade-required");
		await expect(service.resume(connectionId, "session-tip")).rejects.toThrow("upgrade required");
		expect(client.requests.some((request) => request.method === "session.claim")).toBe(false);
	});

	test("an explicit reconnect clears stale runtime bindings before claiming again", async () => {
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");

		expect(client.requests.filter((request) => request.method === "session.claim")).toHaveLength(2);
		expect(client.requests.filter((request) => request.method === "session.release")).toHaveLength(
			1
		);
	});

	test("routes profile-scoped handoff RPCs to the configured Hermes profile", async () => {
		client.capabilities = [...HERMES_REQUIRED_CAPABILITIES, "session.tool_artifacts"];
		const profiledConnectionId = saveHermesConnection(
			{
				label: "Work profile",
				baseUrl: "http://127.0.0.1:8080",
				profileId: "work",
				token: "runtime-secret",
			},
			vault
		).id;

		await service.connect(profiledConnectionId);
		await service.resume(profiledConnectionId, "session-tip");
		await service.origin(profiledConnectionId, "session-tip");
		await service.reportToOrigin({
			connectionId: profiledConnectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-profile",
			content: "Done",
		});
		await service.release(profiledConnectionId, "session-tip");

		for (const method of [
			"session.catalog",
			"session.claim",
			"session.resume",
			"session.origin",
			"session.report_to_origin",
			"session.tool_artifacts",
			"session.release",
		]) {
			const request = client.requests.find((candidate) => candidate.method === method);
			expect(request?.params["profile"]).toBe("work");
		}
	});

	test("maps an older Hermes without session.catalog to upgrade-required", async () => {
		client.catalogMethodMissing = true;
		const catalog = await service.connect(connectionId);
		const cachedCatalog = await service.catalog(connectionId);

		expect(catalog.compatibility.state).toBe("upgrade-required");
		expect(cachedCatalog).toEqual(catalog);
		expect(catalog.compatibility.missingCapabilities).toEqual([...HERMES_REQUIRED_CAPABILITIES]);
		expect(service.getState(connectionId).status).toBe("upgrade-required");
		expect(client.requests.filter((request) => request.method === "session.catalog")).toHaveLength(
			1
		);
	});

	test("keeps a resumed claim when optional artifact backfill is temporarily unavailable", async () => {
		client.capabilities = [...HERMES_REQUIRED_CAPABILITIES, "session.tool_artifacts"];
		client.failToolArtifacts = true;
		await service.connect(connectionId);

		const resumed = await service.resume(connectionId, "session-tip");
		expect(resumed.runtimeSessionId).toBe("runtime-1");
		await service.submit(connectionId, "session-tip", "Continue anyway");
		expect(client.requests.some((request) => request.method === "prompt.submit")).toBe(true);
	});
});
