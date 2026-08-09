import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setDbForTesting } from "../src/main/db";
import { HermesAttachmentStore } from "../src/main/hermes/hermes-attachments";
import {
	ensureHermesLocalConnection,
	listHermesConnections,
	saveHermesConnection,
} from "../src/main/hermes/hermes-connections";
import {
	type HermesBackendChild,
	HermesLocalBackendManager,
	type HermesLocalBackendRuntime,
} from "../src/main/hermes/hermes-local-backend-manager";
import type { HermesStockSessionDetail } from "../src/main/hermes/hermes-rest-client";
import type { HermesRuntimeConnectionSettings } from "../src/main/hermes/hermes-runtime-client";
import type { HermesRestClientLike } from "../src/main/hermes/hermes-runtime-service";
import {
	type HermesRuntimeClientLike,
	HermesRuntimeService,
} from "../src/main/hermes/hermes-runtime-service";
import { HermesTokenVault } from "../src/main/hermes/hermes-token-vault";
import type {
	HermesRuntimeEvent,
	HermesRuntimeState,
	HermesSessionHistory,
	HermesSessionSummary,
} from "../src/shared/hermes";
import { makeTestDb } from "./test-db";

class FakeRuntimeClient implements HermesRuntimeClientLike {
	readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
	private eventListener: ((event: HermesRuntimeEvent) => void) | null = null;
	state: HermesRuntimeState = {
		status: "connected",
		reconnectAttempt: 0,
		lastConnectedAt: 1,
		error: null,
	};
	responses = new Map<string, unknown[]>();
	connectionSettings: HermesRuntimeConnectionSettings | null = null;
	connectGate: Promise<void> | null = null;
	connectCalls = 0;
	disconnectCalls = 0;

	constructor(private readonly operations: string[] = []) {}

	connect(settings: HermesRuntimeConnectionSettings): Promise<void> {
		this.connectCalls++;
		this.connectionSettings = settings;
		return this.connectGate ?? Promise.resolve();
	}

	disconnect(): void {
		this.disconnectCalls++;
		this.state.status = "disconnected";
	}

	request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.operations.push(`rpc:${method}`);
		this.requests.push({ method, params });
		const queued = this.responses.get(method) ?? [];
		if (queued.length === 0) return Promise.resolve({ ok: true });
		const response = queued.shift();
		if (response instanceof Promise) return response;
		return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
	}

	getState(): HermesRuntimeState {
		return { ...this.state };
	}

	subscribe(listener: (event: HermesRuntimeEvent) => void): () => void {
		this.eventListener = listener;
		return () => {
			this.eventListener = null;
		};
	}

	subscribeState(_listener: (state: HermesRuntimeState) => void): () => void {
		return () => undefined;
	}

	emit(event: Partial<HermesRuntimeEvent> & Pick<HermesRuntimeEvent, "type">): void {
		this.eventListener?.({
			runtimeSessionId: null,
			durableSessionId: null,
			turnId: null,
			requestId: null,
			text: null,
			toolName: null,
			status: null,
			payload: {},
			workspaceArtifacts: [],
			receivedAt: Date.now(),
			...event,
		});
	}
}

class Deferred<T> {
	readonly promise: Promise<T>;
	resolve!: (value: T) => void;
	reject!: (error: Error) => void;

	constructor() {
		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
}

class FakeBackendChild extends EventEmitter implements HermesBackendChild {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly pid: number;
	exitCode: number | null = null;
	readonly killSignals: NodeJS.Signals[] = [];

	constructor(pid: number) {
		super();
		this.pid = pid;
	}

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killSignals.push(signal);
		queueMicrotask(() => this.exit(0, signal));
		return true;
	}

	exit(code: number | null, signal: NodeJS.Signals | null = null): void {
		if (this.exitCode !== null) return;
		this.exitCode = code ?? 0;
		this.emit("exit", code, signal);
	}
}

function announceBackend(child: FakeBackendChild, port: number): void {
	queueMicrotask(() => {
		child.stdout.emit("data", Buffer.from(`HERMES_BACKEND_READY port=${port}\n`));
	});
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
	const deadline = Date.now() + 500;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(message);
		await Bun.sleep(1);
	}
}

class FakeRestClient implements HermesRestClientLike {
	sessions: HermesSessionSummary[] = [];
	histories = new Map<string, HermesSessionHistory>();
	details = new Map<string, HermesStockSessionDetail>();
	listCalls = 0;
	transcriptCalls: Array<{ durableSessionId: string; profileId: string }> = [];

	constructor(private readonly operations: string[] = []) {}

	listSessions(): Promise<HermesSessionSummary[]> {
		this.listCalls++;
		return Promise.resolve(this.sessions);
	}

	getTranscript(durableSessionId: string, profileId: string): Promise<HermesSessionHistory> {
		this.operations.push(`rest:history:${durableSessionId}`);
		this.transcriptCalls.push({ durableSessionId, profileId });
		return Promise.resolve(
			this.histories.get(durableSessionId) ?? { durableSessionId, messages: [] }
		);
	}

	getSessionDetail(durableSessionId: string, profileId: string): Promise<HermesStockSessionDetail> {
		const detail = this.details.get(durableSessionId);
		if (!detail) throw new Error("Missing fake session detail");
		return Promise.resolve({ ...detail, profileId });
	}
}

class FakeSendService {
	available = true;
	sends: Array<{
		profileId: string;
		target: { channelId: string; threadId: string };
		content: string;
	}> = [];

	isAvailable(): boolean {
		return this.available;
	}

	send(input: {
		profileId: string;
		target: { channelId: string; threadId: string };
		content: string;
	}): Promise<{ providerMessageId: string | null }> {
		this.sends.push(input);
		return Promise.resolve({ providerMessageId: "provider-1" });
	}
}

function session(id = "stored-1"): HermesSessionSummary {
	return {
		id,
		title: "Stock session",
		preview: "",
		profileId: "work",
		source: "slack",
		updatedAt: 20,
		createdAt: 10,
		archived: false,
		running: false,
		busy: false,
		waitingForUser: false,
		messageCount: 2,
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
	};
}

describe("HermesRuntimeService stock lifecycle", () => {
	const temporaryDirectories: string[] = [];
	let client: FakeRuntimeClient;
	let rest: FakeRestClient;
	let service: HermesRuntimeService;
	let sender: FakeSendService;
	let attachments: HermesAttachmentStore;
	let connectionId: string;
	let operations: string[];
	let vault: HermesTokenVault;

	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		operations = [];
		client = new FakeRuntimeClient(operations);
		rest = new FakeRestClient(operations);
		sender = new FakeSendService();
		rest.sessions = [session()];
		vault = new HermesTokenVault({
			isEncryptionAvailable: () => true,
			encryptString: (value) => Buffer.from(value),
			decryptString: (value) => value.toString(),
		});
		attachments = new HermesAttachmentStore();
		connectionId = saveHermesConnection(
			{
				label: "Local stock Hermes",
				baseUrl: "http://127.0.0.1:9119",
				profileId: "work",
				token: "secret",
			},
			vault
		).id;
		service = new HermesRuntimeService({
			attachmentStore: attachments,
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
		});
	});

	afterEach(async () => {
		service.shutdown();
		_setDbForTesting(null);
		await Promise.all(
			temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
		);
	});

	async function attachmentFixture(): Promise<{
		directory: string;
		filePath: string;
		imagePath: string;
		pdfPath: string;
	}> {
		const directory = await mkdtemp(join(tmpdir(), "superiorswarm-runtime-attachments-"));
		temporaryDirectories.push(directory);
		const imagePath = join(directory, "screen.png");
		const pdfPath = join(directory, "plan.pdf");
		const filePath = join(directory, "notes.txt");
		await writeFile(imagePath, Buffer.from("image-bytes"));
		await writeFile(pdfPath, Buffer.from("%PDF-test"));
		await writeFile(filePath, Buffer.from("file-bytes"));
		return { directory, filePath, imagePath, pdfPath };
	}

	test("connects without protocol.info or fork-only catalog and browses over REST", async () => {
		const catalog = await service.connect(connectionId);

		expect(catalog.sessions.map((item) => item.id)).toEqual(["stored-1"]);
		expect(catalog.compatibility.state).toBe("compatible");
		expect(client.requests).toEqual([]);
		expect(rest.listCalls).toBe(1);
	});

	test("refreshes loopback auth from the served dashboard token before every connect", async () => {
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "served-current-token",
		});

		await service.connect(connectionId);

		expect(client.connectionSettings).toEqual({
			baseUrl: "http://127.0.0.1:9119",
			authMode: "token",
			token: "served-current-token",
		});
		expect(JSON.stringify(await service.catalog(connectionId))).not.toContain(
			"served-current-token"
		);
	});

	test("resolves managed local runtime in memory without persisting its ephemeral endpoint", async () => {
		service.shutdown();
		const managed = ensureHermesLocalConnection({ profileId: "default" }, vault);
		const ensuredProfiles: string[] = [];
		const runtime: HermesLocalBackendRuntime = {
			baseUrl: "http://127.0.0.1:54321",
			profileId: "default",
			token: "ephemeral-managed-token",
		};
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			localBackendManager: {
				ensure: (profileId) => {
					ensuredProfiles.push(profileId);
					return Promise.resolve(runtime);
				},
				subscribeRuntimeInvalidated: () => () => undefined,
				shutdown: () => undefined,
			},
		});

		await service.connect(managed.id);

		expect(ensuredProfiles).toEqual(["default"]);
		expect(client.connectionSettings).toEqual({
			baseUrl: runtime.baseUrl,
			authMode: "token",
			token: runtime.token,
		});
		const stored = listHermesConnections(vault).find((connection) => connection.id === managed.id);
		expect(stored).toMatchObject({ baseUrl: null, hasToken: false, managementMode: "managed" });
	});

	test("retains a retryable managed-local startup error and shuts down child ownership", async () => {
		service.shutdown();
		const managed = ensureHermesLocalConnection({ profileId: "default" }, vault);
		let shutdownCalls = 0;
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			localBackendManager: {
				ensure: () => Promise.reject(new Error("Stock Hermes is unavailable. Retry.")),
				subscribeRuntimeInvalidated: () => () => undefined,
				shutdown: () => {
					shutdownCalls++;
				},
			},
		});

		await expect(service.connect(managed.id)).rejects.toThrow("Stock Hermes is unavailable");
		expect(service.getState(managed.id)).toMatchObject({
			status: "error",
			error: "Stock Hermes is unavailable. Retry.",
		});
		service.shutdown();
		expect(shutdownCalls).toBe(1);
	});

	test("cancels a deferred managed ensure when disconnected before it resolves", async () => {
		service.shutdown();
		const managed = ensureHermesLocalConnection({ profileId: "default" }, vault);
		const deferred = new Deferred<HermesLocalBackendRuntime>();
		let clientCreations = 0;
		service = new HermesRuntimeService({
			clientFactory: () => {
				clientCreations++;
				return new FakeRuntimeClient();
			},
			restClientFactory: () => new FakeRestClient(),
			sendService: sender,
			tokenVault: vault,
			localBackendManager: {
				ensure: () => deferred.promise,
				subscribeRuntimeInvalidated: () => () => undefined,
				shutdown: () => undefined,
			},
		});

		const connecting = service.connect(managed.id);
		service.disconnect(managed.id);
		deferred.resolve({
			baseUrl: "http://127.0.0.1:55001",
			profileId: "default",
			token: "stale-managed-token",
		});

		await expect(connecting).rejects.toThrow("cancelled");
		expect(clientCreations).toBe(0);
		expect(service.getState(managed.id).status).toBe("disconnected");
	});

	test("lets only the newest concurrent connect install a client", async () => {
		const firstGate = new Deferred<void>();
		const clients: FakeRuntimeClient[] = [];
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => {
				const created = new FakeRuntimeClient();
				if (clients.length === 0) created.connectGate = firstGate.promise;
				clients.push(created);
				return created;
			},
			restClientFactory: () => new FakeRestClient(),
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "current-token",
		});

		const staleConnect = service.connect(connectionId);
		const staleResult = staleConnect.catch((error: unknown) => error);
		await waitFor(() => clients.length === 1, "first client was not created");
		const currentConnect = service.connect(connectionId);
		await waitFor(() => clients.length === 2, "replacement client was not created");
		await currentConnect;
		firstGate.resolve();

		const staleError = await staleResult;
		expect(staleError).toBeInstanceOf(Error);
		expect((staleError as Error).message).toContain("cancelled");
		expect(clients[0]?.disconnectCalls).toBe(1);
		expect(clients[1]?.disconnectCalls).toBe(0);
		expect(service.getState(connectionId).status).toBe("connected");
	});

	test("drops stale binding reconciliation after a newer connection installs", async () => {
		const deferredResume = new Deferred<unknown>();
		const clients: FakeRuntimeClient[] = [];
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => {
				const created = new FakeRuntimeClient();
				clients.push(created);
				return created;
			},
			restClientFactory: () => new FakeRestClient(),
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "current-token",
		});
		await service.connect(connectionId);
		clients[0]?.responses.set("session.resume", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
			deferredResume.promise,
		]);
		await service.resume(connectionId, "stored-1");
		clients[0]?.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await waitFor(
			() =>
				clients[0]?.requests.filter((request) => request.method === "session.resume").length === 2,
			"binding reconciliation did not start"
		);

		await service.connect(connectionId);
		deferredResume.resolve({
			session_id: "stale-runtime",
			session_key: "stored-1",
			profile: "work",
		});
		await Bun.sleep(5);

		expect(clients).toHaveLength(2);
		expect(clients[0]?.disconnectCalls).toBe(1);
		expect(service.events(connectionId, 0).events).toEqual([]);
	});

	test("replaces an exited ready managed backend once with fresh REST and WebSocket auth", async () => {
		service.shutdown();
		const managed = ensureHermesLocalConnection({ profileId: "default" }, vault);
		const children: FakeBackendChild[] = [];
		let tokenNumber = 0;
		const manager = new HermesLocalBackendManager({
			executableResolver: () => "/opt/hermes/bin/hermes",
			hermesHomeResolver: () => "/Users/test/.hermes",
			tokenFactory: () => `managed-token-${++tokenNumber}`,
			spawnProcess: () => {
				const child = new FakeBackendChild(52_000 + children.length);
				children.push(child);
				return child;
			},
			dashboardTokenResolver: async (_baseUrl, fallbackToken) => fallbackToken,
			runtimeVerifier: async () => undefined,
			portAnnounceTimeoutMs: 100,
		});
		const clients: FakeRuntimeClient[] = [];
		const restSettings: Array<{ baseUrl: string; profileId: string; token: string }> = [];
		service = new HermesRuntimeService({
			clientFactory: () => {
				const created = new FakeRuntimeClient();
				clients.push(created);
				return created;
			},
			restClientFactory: (settings) => {
				restSettings.push(settings);
				return new FakeRestClient();
			},
			sendService: sender,
			tokenVault: vault,
			localBackendManager: manager,
			recoveryBaseMs: 1,
			recoveryMaxMs: 2,
		});

		const initialConnect = service.connect(managed.id);
		await waitFor(() => children.length === 1, "initial managed child was not started");
		announceBackend(children[0] as FakeBackendChild, 55_101);
		await initialConnect;
		children[0]?.exit(17, null);
		await waitFor(() => children.length === 2, "replacement managed child was not started");
		announceBackend(children[1] as FakeBackendChild, 55_102);
		await waitFor(
			() => service.getState(managed.id).status === "connected" && clients.length === 2,
			"replacement runtime did not connect"
		);

		expect(children).toHaveLength(2);
		expect(clients[0]?.disconnectCalls).toBe(1);
		expect(clients.map((item) => item.connectionSettings)).toEqual([
			{
				baseUrl: "http://127.0.0.1:55101",
				authMode: "token",
				token: "managed-token-1",
			},
			{
				baseUrl: "http://127.0.0.1:55102",
				authMode: "token",
				token: "managed-token-2",
			},
		]);
		expect(restSettings).toEqual([
			{
				baseUrl: "http://127.0.0.1:55101",
				profileId: "default",
				token: "managed-token-1",
			},
			{
				baseUrl: "http://127.0.0.1:55102",
				profileId: "default",
				token: "managed-token-2",
			},
		]);
		await Bun.sleep(10);
		expect(children).toHaveLength(2);
		service.disconnect(managed.id);
		children[1]?.exit(18, null);
		await Bun.sleep(10);
		expect(children).toHaveLength(2);
	});

	test("backs off replacement failures and cancels recovery on shutdown", async () => {
		service.shutdown();
		const managed = ensureHermesLocalConnection({ profileId: "default" }, vault);
		let ensureCalls = 0;
		let shutdownCalls = 0;
		let unsubscribeCalls = 0;
		const invalidation = {
			listener: null as ((event: { profileId: string; baseUrl: string }) => void) | null,
		};
		service = new HermesRuntimeService({
			clientFactory: () => new FakeRuntimeClient(),
			restClientFactory: () => new FakeRestClient(),
			sendService: sender,
			tokenVault: vault,
			localBackendManager: {
				ensure: () => {
					ensureCalls++;
					if (ensureCalls === 1) {
						return Promise.resolve({
							baseUrl: "http://127.0.0.1:55201",
							profileId: "default",
							token: "initial-token",
						});
					}
					return Promise.reject(new Error("replacement unavailable token=hidden-secret"));
				},
				subscribeRuntimeInvalidated: (listener) => {
					invalidation.listener = listener;
					return () => {
						unsubscribeCalls++;
						invalidation.listener = null;
					};
				},
				shutdown: () => {
					shutdownCalls++;
				},
			},
			recoveryBaseMs: 30,
			recoveryMaxMs: 30,
		});
		await service.connect(managed.id);

		invalidation.listener?.({
			profileId: "default",
			baseUrl: "http://127.0.0.1:55201",
		});
		await waitFor(() => ensureCalls === 2, "first recovery attempt did not run");
		await Bun.sleep(5);
		expect(ensureCalls).toBe(2);
		expect(JSON.stringify(service.getState(managed.id))).not.toContain("hidden-secret");

		service.shutdown();
		await Bun.sleep(40);
		expect(ensureCalls).toBe(2);
		expect(unsubscribeCalls).toBe(1);
		expect(shutdownCalls).toBe(1);
	});

	test("reads canonical history without creating a live runtime", async () => {
		await service.connect(connectionId);
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			messages: [
				{
					id: "message-1",
					turnId: null,
					role: "assistant",
					text: "Persisted",
					createdAt: 1,
					status: null,
					toolName: null,
					workspaceArtifacts: [],
				},
			],
		});

		expect((await service.history(connectionId, "stored-1")).messages[0]?.text).toBe("Persisted");
		expect(client.requests).toEqual([]);
	});

	test("creates a titled SuperiorSwarm session and immediately starts its initial topic", async () => {
		client.responses.set("session.create", [
			{ session_id: "runtime-new", stored_session_id: "stored-new", profile: "work" },
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }]);
		await service.connect(connectionId);

		const created = await service.create(connectionId, {
			cwd: "/tmp/worktree",
			initialPrompt: "Investigate ticket SUP-42 and fix the failing release build",
		});

		expect(created).toMatchObject({
			runtimeSessionId: "runtime-new",
			durableSessionId: "stored-new",
			persisted: false,
		});
		expect(await service.history(connectionId, created.durableSessionId)).toEqual({
			durableSessionId: "stored-new",
			messages: [
				expect.objectContaining({
					role: "user",
					text: "Investigate ticket SUP-42 and fix the failing release build",
				}),
			],
		});
		expect(client.requests).toEqual([
			{
				method: "session.create",
				params: {
					title: "Investigate ticket SUP-42 and fix the failing release build",
					source: "superiorswarm",
					profile: "work",
					cwd: "/tmp/worktree",
				},
			},
			{
				method: "prompt.submit",
				params: {
					session_id: "runtime-new",
					text: "Investigate ticket SUP-42 and fix the failing release build",
				},
			},
		]);
		await expect(
			service.submit(connectionId, created.durableSessionId, "Duplicate")
		).rejects.toThrow("already active");
		expect(JSON.stringify(client.requests)).not.toContain("claim");
		expect(rest.transcriptCalls).toEqual([]);
	});

	test("resumes, attaches local image/PDF/file through stock RPC, then submits resolved context", async () => {
		const fixture = await attachmentFixture();
		const selected = await attachments.registerPaths([
			fixture.imagePath,
			fixture.pdfPath,
			fixture.filePath,
		]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-attachments", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("image.attach", [{ attached: true, path: fixture.imagePath }]);
		client.responses.set("pdf.attach", [
			{ attached: true, filename: "plan.pdf", pages_attached: 2 },
		]);
		client.responses.set("file.attach", [
			{
				attached: true,
				name: "notes.txt",
				ref_text: "@file:.hermes/attachments/notes.txt",
			},
		]);
		await service.connect(connectionId);

		await service.submit(
			connectionId,
			"stored-1",
			"Review these files",
			selected.map((item) => item.handle)
		);

		expect(client.requests.map((request) => request.method)).toEqual([
			"session.resume",
			"image.attach",
			"pdf.attach",
			"file.attach",
			"prompt.submit",
		]);
		expect(client.requests[1]?.params).toEqual({
			session_id: "runtime-attachments",
			path: fixture.imagePath,
		});
		expect(client.requests[2]?.params).toEqual({
			session_id: "runtime-attachments",
			path: fixture.pdfPath,
			first_page: 1,
			last_page: 25,
		});
		expect(client.requests[3]?.params).toEqual({
			session_id: "runtime-attachments",
			path: fixture.filePath,
			name: "notes.txt",
		});
		const prompt = String(client.requests[4]?.params["text"]);
		expect(prompt).toContain("Review these files");
		expect(prompt).toContain("screen.png");
		expect(prompt).toContain("plan.pdf");
		expect(prompt).toContain("@file:.hermes/attachments/notes.txt");
		expect(prompt).not.toContain(fixture.directory);
		expect(attachments.size).toBe(0);
	});

	test("uploads remote attachments as stock bytes/data URLs without sending local paths", async () => {
		const fixture = await attachmentFixture();
		const selected = await attachments.registerPaths([
			fixture.imagePath,
			fixture.pdfPath,
			fixture.filePath,
		]);
		connectionId = saveHermesConnection(
			{
				label: "Remote stock Hermes",
				baseUrl: "https://hermes.example.com",
				profileId: "work",
				token: "remote-secret",
			},
			vault
		).id;
		client.responses.set("session.resume", [
			{ session_id: "runtime-remote", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("image.attach_bytes", [{ attached: true, path: "remote-image.png" }]);
		client.responses.set("pdf.attach", [
			{ attached: true, filename: "plan.pdf", pages_attached: 1 },
		]);
		client.responses.set("file.attach", [
			{ attached: true, ref_text: "@file:attachments/notes.txt" },
		]);
		await service.connect(connectionId);

		await service.submit(
			connectionId,
			"stored-1",
			"Inspect",
			selected.map((item) => item.handle)
		);

		expect(client.requests.map((request) => request.method)).toEqual([
			"session.resume",
			"image.attach_bytes",
			"pdf.attach",
			"file.attach",
			"prompt.submit",
		]);
		expect(client.requests[1]?.params).toEqual({
			session_id: "runtime-remote",
			content_base64: Buffer.from("image-bytes").toString("base64"),
			filename: "screen.png",
		});
		expect(client.requests[2]?.params).toEqual({
			session_id: "runtime-remote",
			content_base64: Buffer.from("%PDF-test").toString("base64"),
			filename: "plan.pdf",
			first_page: 1,
			last_page: 25,
		});
		expect(client.requests[3]?.params).toEqual({
			session_id: "runtime-remote",
			data_url: `data:text/plain;base64,${Buffer.from("file-bytes").toString("base64")}`,
			name: "notes.txt",
		});
		expect(JSON.stringify(client.requests)).not.toContain(fixture.directory);
	});

	test("retains failed attachments for retry and does not duplicate an already attached file", async () => {
		const fixture = await attachmentFixture();
		const selected = await attachments.registerPaths([fixture.imagePath, fixture.filePath]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-retry", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("image.attach", [{ attached: true, path: fixture.imagePath }]);
		client.responses.set("file.attach", [
			new Error(`token=hidden-secret failed at ${fixture.filePath}`),
			{ attached: true, ref_text: "@file:attachments/notes.txt" },
		]);
		await service.connect(connectionId);
		const handles = selected.map((item) => item.handle);

		const firstFailure = await service
			.submit(connectionId, "stored-1", "Retry safely", handles)
			.catch((error: unknown) => error);

		expect(firstFailure).toBeInstanceOf(Error);
		expect((firstFailure as Error).message).not.toContain("hidden-secret");
		expect((firstFailure as Error).message).not.toContain(fixture.directory);
		expect(attachments.size).toBe(2);

		await service.submit(connectionId, "stored-1", "Retry safely", handles);

		expect(client.requests.map((request) => request.method)).toEqual([
			"session.resume",
			"image.attach",
			"file.attach",
			"file.attach",
			"prompt.submit",
		]);
		expect(attachments.size).toBe(0);
	});

	test("rejects a non-stock general-file reference and keeps the handle retryable", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.filePath]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-bad-ref", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("file.attach", [
			{ attached: true, ref_text: "file:///private/notes.txt" },
		]);
		await service.connect(connectionId);

		await expect(
			service.submit(connectionId, "stored-1", "Inspect", [selected?.handle ?? ""])
		).rejects.toThrow("valid @file reference");

		expect(client.requests.map((request) => request.method)).toEqual([
			"session.resume",
			"file.attach",
		]);
		expect(attachments.size).toBe(1);
	});

	test("buffers an initial-topic submission failure for the newly selected session", async () => {
		client.responses.set("session.create", [
			{ session_id: "runtime-new", stored_session_id: "stored-new", profile: "work" },
		]);
		client.responses.set("prompt.submit", [new Error("token=secret provider rejected topic")]);
		await service.connect(connectionId);

		await service.create(connectionId, { initialPrompt: "Start the task" });
		await Bun.sleep(0);

		const error = service
			.events(connectionId, 0)
			.events.find((entry) => entry.event.type === "runtime.error")?.event;
		expect(error?.text).toContain("provider rejected topic");
		expect(error?.text).not.toContain("secret");
	});

	test("refreshes before resume and activates an already-warm stock runtime", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("session.activate", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
		]);
		await service.connect(connectionId);

		await service.resume(connectionId, "stored-1");
		await service.resume(connectionId, "stored-1");

		expect(rest.transcriptCalls[0]).toEqual({ durableSessionId: "stored-1", profileId: "work" });
		expect(client.requests.map((request) => request.method)).toEqual([
			"session.resume",
			"session.activate",
		]);
		expect(client.requests[0]?.params).toEqual({
			session_id: "stored-1",
			profile: "work",
			source: "superiorswarm",
			omit_messages: true,
		});
	});

	test("routes approval, clarification, and interrupt with runtime identity only", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");

		await service.respondToApproval({
			connectionId,
			hermesSessionId: "stored-1",
			requestId: "approval-1",
			choice: "allow_once",
		});
		await service.respondToClarification({
			connectionId,
			hermesSessionId: "stored-1",
			requestId: "clarify-1",
			answer: "production",
		});
		await service.interrupt(connectionId, "stored-1");

		expect(client.requests.slice(1)).toEqual([
			{
				method: "approval.respond",
				params: {
					session_id: "runtime-1",
					request_id: "approval-1",
					choice: "allow_once",
				},
			},
			{
				method: "clarify.respond",
				params: {
					session_id: "runtime-1",
					request_id: "clarify-1",
					answer: "production",
				},
			},
			{ method: "session.interrupt", params: { session_id: "runtime-1" } },
		]);
	});

	test("reacquires runtime IDs after reconnect while preserving durable selection", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
			{ session_id: "runtime-2", session_key: "stored-1", profile: "work" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");

		client.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await Bun.sleep(5);

		const feed = service.events(connectionId, 0);
		const reconciled = feed.events.find(
			(entry) => entry.event.type === "runtime.history-refresh-required"
		);
		expect(reconciled?.event.payload.bindings).toEqual([
			{
				hermesSessionId: "stored-1",
				durableSessionId: "stored-1",
				runtimeSessionId: "runtime-2",
				activeTurn: false,
				status: null,
			},
		]);
		expect(client.requests.filter((request) => request.method === "session.resume")).toHaveLength(
			2
		);
	});

	test("clears a stale active turn when reconnect resume says the stock session is idle", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
			},
			{
				session_id: "runtime-2",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
			},
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }, { status: "streaming" }]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		await service.submit(connectionId, "stored-1", "Keep working");
		const historyCallsBeforeReconnect = rest.transcriptCalls.length;

		client.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await Bun.sleep(5);

		expect(rest.transcriptCalls.length).toBe(historyCallsBeforeReconnect + 1);
		expect(operations.at(-1)).toBe("rest:history:stored-1");
		await expect(
			service.submit(connectionId, "stored-1", "Continue after reconnect")
		).resolves.toEqual({ ok: true });
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
		const reconciled = service
			.events(connectionId, 0)
			.events.find((entry) => entry.event.type === "runtime.history-refresh-required");
		expect(reconciled?.event.payload.bindings?.[0]).toMatchObject({
			activeTurn: false,
			status: "idle",
		});
	});

	test("keeps the session busy when reconnect resume says a stock turn is running", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
			},
			{
				session_id: "runtime-2",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");

		client.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await Bun.sleep(5);

		await expect(service.submit(connectionId, "stored-1", "Overlapping turn")).rejects.toThrow(
			"already active"
		);
		const reconciled = service
			.events(connectionId, 0)
			.events.find((entry) => entry.event.type === "runtime.history-refresh-required");
		expect(reconciled?.event.payload.bindings?.[0]).toMatchObject({
			activeTurn: true,
			status: "working",
		});
	});

	test("maps live events to durable IDs and refreshes REST after terminal completion", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		const callsBeforeCompletion = rest.transcriptCalls.length;

		client.emit({
			type: "message.complete",
			runtimeSessionId: "runtime-1",
			text: "Done",
		});
		await Bun.sleep(5);

		const completion = service
			.events(connectionId, 0)
			.events.find((entry) => entry.event.type === "message.complete");
		expect(completion?.event.durableSessionId).toBe("stored-1");
		expect(rest.transcriptCalls.length).toBeGreaterThan(callsBeforeCompletion);
	});

	test("reports only canonical persisted assistant content to a main-resolved Slack target", async () => {
		rest.details.set("stored-1", {
			durableSessionId: "stored-1",
			profileId: "work",
			source: "slack",
			displayName: "Support thread",
			sessionKey: null,
			chatId: "C12345",
			chatType: "channel",
			threadId: "1234567890.123456",
			originJson: { platform: "slack", scope_id: "T12345", secret: "never-render" },
		});
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			messages: [
				{
					id: "assistant-1",
					turnId: "turn-1",
					role: "assistant",
					text: "Canonical persisted update",
					createdAt: 1,
					status: "complete",
					toolName: null,
					workspaceArtifacts: [],
				},
			],
		});
		await service.connect(connectionId);

		const origin = await service.origin(connectionId, "stored-1");
		expect(origin).toMatchObject({
			platform: "slack",
			displayLabel: "Support thread",
			hasThread: true,
			canOpenThread: true,
			canReport: true,
		});
		expect(origin).not.toHaveProperty("target");
		expect(JSON.stringify(origin)).not.toContain("never-render");

		const sent = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "stored-1",
			messageId: "assistant-1",
			explicitRetry: false,
		});
		expect(sent).toMatchObject({ status: "sent", providerMessageId: "provider-1" });
		expect(sender.sends).toEqual([
			{
				profileId: "work",
				target: { channelId: "C12345", threadId: "1234567890.123456" },
				content: "Canonical persisted update",
			},
		]);

		const duplicate = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "stored-1",
			messageId: "assistant-1",
			explicitRetry: false,
		});
		expect(duplicate.status).toBe("duplicate-suppressed");
		expect(sender.sends).toHaveLength(1);
	});
});
