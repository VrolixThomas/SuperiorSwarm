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
	releaseBusyRemaining = 0;
	releaseErrors: Error[] = [];
	failResumeNumbers = new Set<number>();
	historyTurnResults: Array<Record<string, unknown>> = [
		{
			turn_id: "turn-1",
			content: "Done",
			completed_at: 300,
			status: "complete",
		},
	];
	claimCount = 0;
	resumeCount = 0;
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
				this.claimCount++;
				return {
					claim: {
						claim_id: `claim-${this.claimCount}`,
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
				this.resumeCount++;
				if (this.failResumeNumbers.has(this.resumeCount)) {
					throw new Error("resume temporarily unavailable");
				}
				return {
					session_id: `runtime-${this.resumeCount}`,
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
					turn_results: this.historyTurnResults,
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
				if (this.releaseErrors.length > 0) throw this.releaseErrors.shift();
				if (this.releaseBusyRemaining > 0) {
					this.releaseBusyRemaining--;
					return {
						released: false,
						busy: true,
						retryable: true,
						error: "Hermes session is busy",
					};
				}
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
		expect(resumed.history.messages[0]?.text).toBe("Created workspace");
		expect(resumed.history.turnResults[0]).toEqual({
			turnId: "turn-1",
			content: "Done",
			completedAt: 300,
			status: "complete",
		});
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
		});
		expect(report.status).toBe("sent");
		expect(report.permalink).toBe("https://slack.com/archives/thread");
		const repeatedReport = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-1",
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
		client.historyTurnResults = [
			{ turn_id: "turn-tip", content: "Finished", completed_at: 400, status: "complete" },
		];
		await service.connect(connectionId);
		await service.resume(connectionId, "session-canonical");
		const originInfo = await service.origin(connectionId, "session-canonical");
		await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-canonical",
			turnId: "turn-tip",
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
		await service.resume(connectionId, "session-tip");
		client.historyTurnResults = [
			{
				turn_id: "turn-network-failure",
				content: "Finished",
				completed_at: 500,
				status: "complete",
			},
		];
		client.failReport = true;
		const report = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-network-failure",
		});

		expect(report.status).toBe("failed");
		expect(report.retryable).toBe(true);
	});

	test("reports the exact latest durable result after reopening without a live completion event", async () => {
		client.historyTurnResults = [
			{ turn_id: "turn-old", content: "Old", completed_at: 100, status: "complete" },
			{
				turn_id: "turn-latest",
				content: "Exact durable result with API_KEY=main-only-secret",
				completed_at: 200,
				status: "complete",
				result: { output: "must-never-reach-renderer" },
			},
		];
		await service.connect(connectionId);
		const firstOpen = await service.resume(connectionId, "session-tip");
		expect(firstOpen.history.turnResults.at(-1)?.content).toBe(
			"Exact durable result with API_KEY=[redacted]"
		);
		expect(JSON.stringify(firstOpen.history)).not.toContain("main-only-secret");
		expect(JSON.stringify(firstOpen.history)).not.toContain("must-never-reach-renderer");
		await service.release(connectionId, "session-tip");

		const reopened = await service.resume(connectionId, "session-tip");
		expect(reopened.history.turnResults.at(-1)?.turnId).toBe("turn-latest");
		await service.reportToOrigin({
			connectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-latest",
		});

		const request = client.requests.find(
			(candidate) =>
				candidate.method === "session.report_to_origin" &&
				candidate.params["turn_id"] === "turn-latest"
		);
		expect(request?.params["content"]).toBe("Exact durable result with API_KEY=main-only-secret");
	});

	test("keeps a busy release explicitly active and renewable for safe retry", async () => {
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");
		client.releaseBusyRemaining = 1;

		const busy = await service.release(connectionId, "session-tip");
		expect(busy).toEqual({
			unbound: false,
			released: false,
			retryable: true,
			error: "Hermes session is busy",
		});
		const safelyRebound = await service.resume(connectionId, "session-tip");
		expect(safelyRebound.claimId).toBe("claim-1");
		await service.submit(connectionId, "session-tip", "Still safely bound");

		const retried = await service.release(connectionId, "session-tip");
		expect(retried).toEqual({
			unbound: true,
			released: true,
			retryable: false,
			error: null,
		});
	});

	test("remembers an automatic unbind rejected with 4094 and releases after turn completion", async () => {
		await service.connect(connectionId);
		const resumed = await service.resume(connectionId, "session-tip");
		client.releaseErrors.push(new HermesRpcError("Hermes session is busy", 4094, true));

		const deferred = await service.unbind(connectionId, "session-tip", resumed.claimId);
		expect(deferred).toEqual({
			unbound: false,
			released: false,
			retryable: true,
			error: "Hermes session is busy",
		});

		client.eventListener?.({
			type: "message.complete",
			sessionId: resumed.runtimeSessionId,
			turnId: "turn-1",
			requestId: null,
			text: "Done",
			toolName: null,
			status: "complete",
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
		await Bun.sleep(10);

		expect(client.requests.filter((request) => request.method === "session.release")).toHaveLength(
			2
		);
		const rebound = await service.resume(connectionId, "session-tip");
		expect(rebound.claimId).toBe("claim-2");
	});

	test("retries a hidden busy binding until the deferred release succeeds", async () => {
		service.shutdown();
		const retryCallbacks: Array<() => void> = [];
		const retryTimer = { unref: () => retryTimer } as unknown as ReturnType<typeof setTimeout>;
		service = new HermesRuntimeService({
			clientFactory: () => client,
			tokenVault: vault,
			releaseRetryTimerApi: {
				set: (callback) => {
					retryCallbacks.push(callback);
					return retryTimer;
				},
				clear: () => {
					retryCallbacks.length = 0;
				},
			},
		});
		await service.connect(connectionId);
		const resumed = await service.resume(connectionId, "session-tip");
		client.releaseBusyRemaining = 1;

		const deferred = await service.unbind(connectionId, "session-tip", resumed.claimId);
		expect(deferred.unbound).toBe(false);
		const runRetry = retryCallbacks.shift();
		expect(runRetry).toBeDefined();
		runRetry?.();
		await Bun.sleep(0);

		expect(client.requests.filter((request) => request.method === "session.release")).toHaveLength(
			2
		);
		const rebound = await service.resume(connectionId, "session-tip");
		expect(rebound.claimId).toBe("claim-2");
	});

	test("invalidates a local binding after nonretryable 4092 instead of renewing it", async () => {
		await service.connect(connectionId);
		const resumed = await service.resume(connectionId, "session-tip");
		client.releaseErrors.push(new HermesRpcError("Claim is missing or not owned", 4092, false));

		const invalidated = await service.unbind(connectionId, "session-tip", resumed.claimId);
		expect(invalidated).toEqual({
			unbound: true,
			released: false,
			retryable: false,
			error: "Claim is missing or not owned",
		});

		const rebound = await service.resume(connectionId, "session-tip");
		expect(rebound.claimId).toBe("claim-2");
		expect(client.requests.filter((request) => request.method === "session.claim")).toHaveLength(2);
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

	test("idempotently unbinds only the expected claim and cannot release a newer binding", async () => {
		await service.connect(connectionId);
		const first = await service.resume(connectionId, "session-tip");
		const released = await service.unbind(connectionId, "session-tip", first.claimId);
		const repeated = await service.unbind(connectionId, "session-tip", first.claimId);
		const second = await service.resume(connectionId, "session-tip");
		const staleCleanup = await service.unbind(connectionId, "session-tip", first.claimId);
		await service.submit(connectionId, "session-tip", "Still bound");

		expect(released).toEqual({
			unbound: true,
			released: true,
			retryable: false,
			error: null,
		});
		expect(repeated).toEqual({
			unbound: false,
			released: false,
			retryable: false,
			error: null,
		});
		expect(staleCleanup).toEqual({
			unbound: false,
			released: false,
			retryable: false,
			error: null,
		});
		expect(second).toMatchObject({ claimId: "claim-2", runtimeSessionId: "runtime-2" });
		const submit = [...client.requests]
			.reverse()
			.find((request) => request.method === "prompt.submit");
		expect(submit?.params).toMatchObject({ claim_id: "claim-2", session_id: "runtime-2" });
		expect(client.requests.filter((request) => request.method === "session.release")).toHaveLength(
			1
		);
	});

	test("rebinds durable sessions after transport reconnect before requesting history", async () => {
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");
		const beforeReconnect = client.requests.length;

		const reconnectEvent: HermesRuntimeEvent = {
			type: "runtime.history-refresh-required",
			sessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: "reconnected",
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		};
		client.eventListener?.(reconnectEvent);
		client.eventListener?.(reconnectEvent);
		await Bun.sleep(10);

		const reconnectMethods = client.requests
			.slice(beforeReconnect)
			.map((request) => request.method);
		expect(reconnectMethods.filter((method) => method === "session.claim")).toHaveLength(1);
		expect(reconnectMethods.filter((method) => method === "session.resume")).toHaveLength(1);
		expect(reconnectMethods.indexOf("session.claim")).toBeLessThan(
			reconnectMethods.indexOf("session.resume")
		);
		expect(reconnectMethods.indexOf("session.resume")).toBeLessThan(
			reconnectMethods.indexOf("session.history")
		);

		await service.submit(connectionId, "session-tip", "After reconnect");
		const submit = [...client.requests]
			.reverse()
			.find((request) => request.method === "prompt.submit");
		expect(submit?.params).toMatchObject({ claim_id: "claim-2", session_id: "runtime-2" });
		const refresh = service
			.events(connectionId, 0)
			.events.reverse()
			.find((entry) => entry.event.type === "runtime.history-refresh-required");
		expect(refresh?.event.payload).toEqual({
			bindings: [
				{
					hermesSessionId: "session-tip",
					canonicalSessionId: "session-tip",
					runtimeSessionId: "runtime-2",
					claimId: "claim-2",
				},
			],
			failedSessionIds: [],
		});
	});

	test("rebinds every currently bound durable session after one reconnect", async () => {
		await service.connect(connectionId);
		await service.resume(connectionId, "session-tip");
		await service.resume(connectionId, "session-other");
		const beforeReconnect = client.requests.length;

		client.eventListener?.({
			type: "runtime.history-refresh-required",
			sessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: "reconnected",
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
		await Bun.sleep(10);

		const reconnectRequests = client.requests.slice(beforeReconnect);
		expect(reconnectRequests.filter((request) => request.method === "session.claim")).toHaveLength(
			2
		);
		expect(reconnectRequests.filter((request) => request.method === "session.resume")).toHaveLength(
			2
		);
		expect(
			reconnectRequests.filter((request) => request.method === "session.history")
		).toHaveLength(2);
		await service.submit(connectionId, "session-tip", "First rebound thread");
		await service.submit(connectionId, "session-other", "Second rebound thread");
		const submits = client.requests.filter((request) => request.method === "prompt.submit");
		expect(submits.at(-2)?.params).toMatchObject({ claim_id: "claim-3", session_id: "runtime-3" });
		expect(submits.at(-1)?.params).toMatchObject({ claim_id: "claim-4", session_id: "runtime-4" });
	});

	test("keeps reconnect failures recoverable and retries without duplicate renewal bindings", async () => {
		await service.connect(connectionId);
		const first = await service.resume(connectionId, "session-tip");
		client.failResumeNumbers.add(2);
		client.eventListener?.({
			type: "runtime.history-refresh-required",
			sessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: "reconnected",
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
		await Bun.sleep(10);

		const failedRefresh = service
			.events(connectionId, 0)
			.events.reverse()
			.find((entry) => entry.event.type === "runtime.history-refresh-required");
		expect(failedRefresh?.event.payload).toEqual({
			bindings: [],
			failedSessionIds: ["session-tip"],
		});
		expect(
			service.events(connectionId, 0).events.some((entry) => entry.event.type === "runtime.error")
		).toBe(true);

		const recovered = await service.resume(connectionId, "session-tip");
		expect(recovered).toMatchObject({ claimId: "claim-3", runtimeSessionId: "runtime-3" });
		const staleCleanup = await service.unbind(connectionId, "session-tip", first.claimId);
		expect(staleCleanup).toEqual({
			unbound: false,
			released: false,
			retryable: false,
			error: null,
		});
		await service.submit(connectionId, "session-tip", "Recovered");
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
		client.eventListener?.({
			type: "runtime.history-refresh-required",
			sessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: "reconnected",
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
		});
		await Bun.sleep(10);
		await service.origin(profiledConnectionId, "session-tip");
		client.historyTurnResults = [
			{ turn_id: "turn-profile", content: "Done", completed_at: 600, status: "complete" },
		];
		await service.reportToOrigin({
			connectionId: profiledConnectionId,
			hermesSessionId: "session-tip",
			turnId: "turn-profile",
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
			const requests = client.requests.filter((candidate) => candidate.method === method);
			expect(requests.length).toBeGreaterThan(0);
			for (const request of requests) expect(request.params["profile"]).toBe("work");
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
