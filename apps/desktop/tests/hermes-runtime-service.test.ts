import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { _setDbForTesting, getDb, schema } from "../src/main/db";
import { HermesAttachmentStore } from "../src/main/hermes/hermes-attachments";
import {
	deleteHermesConnection,
	ensureHermesLocalConnection,
	listHermesConnections,
	saveHermesConnection,
} from "../src/main/hermes/hermes-connections";
import {
	type HermesBackendChild,
	HermesLocalBackendManager,
	type HermesLocalBackendRuntime,
} from "../src/main/hermes/hermes-local-backend-manager";
import { getHermesOriginLink, saveHermesOriginLink } from "../src/main/hermes/hermes-origin-links";
import {
	listHermesOriginReports,
	prepareHermesOriginReport,
} from "../src/main/hermes/hermes-origin-reports";
import {
	HermesRestClient,
	type HermesStockSessionDetail,
} from "../src/main/hermes/hermes-rest-client";
import {
	HermesRuntimeClient,
	type HermesRuntimeConnectionSettings,
	type HermesSocket,
} from "../src/main/hermes/hermes-runtime-client";
import type { HermesRestClientLike } from "../src/main/hermes/hermes-runtime-service";
import {
	type HermesRuntimeClientLike,
	HermesRuntimeService,
} from "../src/main/hermes/hermes-runtime-service";
import {
	admitHermesSession,
	listHermesSessionAdmissions,
} from "../src/main/hermes/hermes-session-admissions";
import { HermesTokenVault } from "../src/main/hermes/hermes-token-vault";
import {
	linkHermesWorkspace,
	listHermesWorkspaceLinks,
} from "../src/main/hermes/hermes-workspace-links";
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
			profileId: null,
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

type RuntimeSocketListener = (event: { data?: unknown }) => void;

class ServiceRuntimeSocket implements HermesSocket {
	readonly listeners = new Map<string, Set<RuntimeSocketListener>>();
	readyState = 0;

	constructor(
		private readonly onSend: (
			socket: ServiceRuntimeSocket,
			request: { id: string; method: string; params: Record<string, unknown> }
		) => void
	) {}

	addEventListener(type: string, listener: RuntimeSocketListener): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: RuntimeSocketListener): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		this.onSend(
			this,
			JSON.parse(data) as {
				id: string;
				method: string;
				params: Record<string, unknown>;
			}
		);
	}

	close(): void {
		if (this.readyState >= 2) return;
		this.readyState = 3;
		this.emit("close", {});
	}

	open(): void {
		this.readyState = 1;
		this.emit("open", {});
	}

	message(value: unknown): void {
		this.emit("message", { data: JSON.stringify(value) });
	}

	private emit(type: string, event: { data?: unknown }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
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
	revisionCalls: Array<{ durableSessionId: string; profileId: string }> = [];
	tailCalls: Array<{ durableSessionId: string; profileId: string; limit: number }> = [];
	archiveCalls: Array<{ durableSessionId: string; profileId: string; archived: boolean }> = [];
	deleteCalls: Array<{ durableSessionId: string; profileId: string }> = [];
	failCatalogRefreshAfterDelete = false;
	private nextListError: Error | null = null;

	constructor(private readonly operations: string[] = []) {}

	listSessions(): Promise<HermesSessionSummary[]> {
		this.listCalls++;
		if (this.nextListError) {
			const error = this.nextListError;
			this.nextListError = null;
			return Promise.reject(error);
		}
		return Promise.resolve(this.sessions);
	}

	getTranscript(durableSessionId: string, profileId: string): Promise<HermesSessionHistory> {
		this.operations.push(`rest:history:${durableSessionId}`);
		this.transcriptCalls.push({ durableSessionId, profileId });
		return Promise.resolve(
			this.histories.get(durableSessionId) ?? { durableSessionId, view: "active", messages: [] }
		);
	}

	getSessionRevision(durableSessionId: string, profileId: string) {
		this.revisionCalls.push({ durableSessionId, profileId });
		return Promise.resolve({
			durableSessionId,
			latestMessageId: "12",
			latestMessageAt: 2_000,
			latestMessageIdIsStable: true,
		});
	}

	getTranscriptTail(durableSessionId: string, profileId: string, limit = 100) {
		this.tailCalls.push({ durableSessionId, profileId, limit });
		const history = this.histories.get(durableSessionId) ?? {
			durableSessionId,
			view: "active" as const,
			messages: [],
		};
		return Promise.resolve({
			...history,
			total: history.messages.length,
			complete: true,
			messageIdsAreStable: true,
		});
	}

	getSessionDetail(durableSessionId: string, profileId: string): Promise<HermesStockSessionDetail> {
		const detail = this.details.get(durableSessionId);
		if (!detail) throw new Error("Missing fake session detail");
		return Promise.resolve({ ...detail, profileId });
	}

	setSessionArchived(
		durableSessionId: string,
		profileId: string,
		archived: boolean
	): Promise<void> {
		this.archiveCalls.push({ durableSessionId, profileId, archived });
		this.sessions = this.sessions.map((item) =>
			item.id === durableSessionId && item.profileId === profileId ? { ...item, archived } : item
		);
		return Promise.resolve();
	}

	deleteSession(durableSessionId: string, profileId: string): Promise<void> {
		this.deleteCalls.push({ durableSessionId, profileId });
		this.sessions = this.sessions.filter(
			(item) => item.id !== durableSessionId || item.profileId !== profileId
		);
		if (this.failCatalogRefreshAfterDelete) {
			this.nextListError = new Error("catalog refresh unavailable");
		}
		return Promise.resolve();
	}
}

class FakeSendService {
	available = true;
	response: Promise<{ providerMessageId: string | null }> | null = null;
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
		return this.response ?? Promise.resolve({ providerMessageId: "provider-1" });
	}
}

function session(id = "stored-1"): HermesSessionSummary {
	return {
		id,
		lineageRootId: id,
		activeTipId: id,
		title: "Stock session",
		generatedTitle: "Stock session",
		titleSource: "generated",
		tags: [],
		metadataRevision: 0,
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
		isCron: false,
		handover: true,
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
	};
}

function historyMessage(
	id: string,
	overrides: Partial<HermesSessionHistory["messages"][number]> = {}
): HermesSessionHistory["messages"][number] {
	return {
		id,
		canonicalMessageId: id,
		compactionGeneration: 0,
		active: true,
		compacted: false,
		displayKind: null,
		compactionSummaryType: null,
		turnId: null,
		role: "assistant",
		text: id,
		createdAt: 1,
		status: "complete",
		toolName: null,
		workspaceArtifacts: [],
		...overrides,
	};
}

function compressedHistory(
	parentDurableSessionId: string,
	childDurableSessionId: string,
	messages: HermesSessionHistory["messages"] = []
): HermesSessionHistory & {
	compressionLineage: {
		kind: "compression";
		parentDurableSessionId: string;
		childDurableSessionId: string;
		verifiedBy: "durable-transcript";
	};
} {
	return {
		durableSessionId: childDurableSessionId,
		view: "durable",
		messages,
		compressionLineage: {
			kind: "compression",
			parentDurableSessionId,
			childDurableSessionId,
			verifiedBy: "durable-transcript",
		},
	};
}

describe("HermesRuntimeService stock lifecycle", () => {
	const defaultManagerId = "runtime-test-manager";
	const temporaryDirectories: string[] = [];
	let client: FakeRuntimeClient;
	let rest: FakeRestClient;
	let service: HermesRuntimeService;
	let sender: FakeSendService;
	let attachments: HermesAttachmentStore;
	let connectionId: string;
	let operations: string[];
	let vault: HermesTokenVault;

	function admitAgentSession(durableSessionId: string, profileId = "work"): void {
		admitHermesSession({
			managerId: defaultManagerId,
			metadata: {
				schemaVersion: 1,
				durableSessionId,
				profileId,
				sourcePlatform: "superiorswarm",
				isCron: false,
			},
			reason: "agents",
		});
	}

	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: defaultManagerId,
				name: "Runtime test manager",
				workDir: "/tmp/runtime-test-manager",
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: "e".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
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
			externalManagerIdResolver: () => defaultManagerId,
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

	test("does not mirror an unrelated external Slack session into the Agents catalog", async () => {
		const catalog = await service.connect(connectionId);

		expect(catalog.sessions).toEqual([]);
		expect(catalog.compatibility.state).toBe("compatible");
		expect(client.requests).toEqual([]);
		expect(rest.listCalls).toBe(1);
	});

	test("wakes a long-poll event reader immediately when the stock WebSocket emits", async () => {
		await service.connect(connectionId);
		const pending = service.waitForEvents(connectionId, 0, defaultManagerId, 1_000);
		client.emit({ type: "message.delta", text: "pushed" });

		const feed = await pending;
		expect(feed.events).toEqual([
			expect.objectContaining({ event: expect.objectContaining({ type: "message.delta" }) }),
		]);
		expect(feed.nextSeq).toBe(1);
	});

	test("restores the root-scoped FIFO outbox across a full main-process restart", async () => {
		await service.submitFollowUp(connectionId, "stored-1", "first", [], "work", "client-first");
		await service.submitFollowUp(connectionId, "stored-1", "second", [], "work", "client-second");
		service.shutdown();

		client = new FakeRuntimeClient(operations);
		rest = new FakeRestClient(operations);
		attachments = new HermesAttachmentStore();
		service = new HermesRuntimeService({
			attachmentStore: attachments,
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => defaultManagerId,
		});

		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ id: "client-first", text: "first", status: "queued" }),
			expect.objectContaining({ id: "client-second", text: "second", status: "queued" }),
		]);
	});

	test("restores queued attachments as explicit non-sendable recovery rows", async () => {
		const fixture = await attachmentFixture();
		const [attachment] = await attachments.registerPaths([fixture.filePath]);
		if (!attachment) throw new Error("Missing attachment fixture");
		await service.submitFollowUp(
			connectionId,
			"stored-1",
			"with file",
			[attachment.handle],
			"work",
			"client-attachment"
		);
		service.shutdown();

		attachments = new HermesAttachmentStore();
		service = new HermesRuntimeService({
			attachmentStore: attachments,
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => defaultManagerId,
		});

		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({
				id: "client-attachment",
				status: "failed",
				error: "Attachments from the previous app run are unavailable; cancel and resend.",
			}),
		]);
		await expect(
			service.retryFollowUp(connectionId, "stored-1", "client-attachment", "work")
		).rejects.toThrow("cancel and resend");
	});

	test("admits a continuation child from catalog lineage before any history request", async () => {
		admitAgentSession("conversation-root");
		rest.sessions = [
			{
				...session("continuation-child"),
				lineageRootId: "conversation-root",
				activeTipId: "continuation-child",
				source: "superiorswarm",
				origin: null,
			},
		];

		const catalog = await service.connect(connectionId);

		expect(catalog.sessions).toEqual([
			expect.objectContaining({
				id: "continuation-child",
				lineageRootId: "conversation-root",
				activeTipId: "continuation-child",
				admissionReason: "agents",
			}),
		]);
		expect(rest.transcriptCalls).toEqual([]);

		await service.history(connectionId, "conversation-root", "work");

		expect(rest.transcriptCalls).toEqual([
			{ durableSessionId: "continuation-child", profileId: "work" },
		]);
		expect(listHermesSessionAdmissions(defaultManagerId)).toEqual([
			expect.objectContaining({ durableSessionId: "conversation-root" }),
		]);
	});

	test("keeps the continuation outbox on the lineage root while targeting the active tip", async () => {
		admitAgentSession("conversation-root");
		rest.sessions = [
			{
				...session("continuation-child"),
				lineageRootId: "conversation-root",
				activeTipId: "continuation-child",
				source: "superiorswarm",
				origin: null,
			},
		];
		client.responses.set("session.resume", [
			{
				session_id: "runtime-child",
				stored_session_id: "continuation-child",
				profile: "work",
				running: true,
				status: "streaming",
				inflight: { user: "current" },
			},
		]);
		await service.connect(connectionId);
		const resumed = await service.resume(connectionId, "conversation-root", "work");
		expect(resumed).toMatchObject({
			durableSessionId: "continuation-child",
			activeTurnSnapshot: { durableSessionId: "conversation-root" },
		});

		await service.submitFollowUp(
			connectionId,
			"conversation-root",
			"next",
			[],
			"work",
			"client-root"
		);

		expect(service.followUps(connectionId, "conversation-root", "work")).toEqual([
			expect.objectContaining({
				id: "client-root",
				durableSessionId: "conversation-root",
				status: "queued",
			}),
		]);
		expect(service.followUps(connectionId, "continuation-child", "work")).toEqual(
			service.followUps(connectionId, "conversation-root", "work")
		);
		expect(client.requests[0]).toEqual({
			method: "session.resume",
			params: {
				session_id: "continuation-child",
				profile: "work",
				source: "superiorswarm",
				omit_messages: false,
			},
		});
		client.emit({
			type: "message.delta",
			runtimeSessionId: "runtime-child",
			text: "partial",
		});
		expect(service.events(connectionId, 0).events.at(-1)?.event).toMatchObject({
			type: "message.delta",
			durableSessionId: "conversation-root",
		});
	});

	test("polls revision and tail using the selected composite profile identity", async () => {
		await service.connect(connectionId);
		const revision = await service.historyRevision(connectionId, "same-id", "travel");
		const tail = await service.historyTail(connectionId, "same-id", "travel", 75);

		expect(revision.durableSessionId).toBe("same-id");
		expect(tail.durableSessionId).toBe("same-id");
		expect(rest.revisionCalls).toEqual([{ durableSessionId: "same-id", profileId: "travel" }]);
		expect(rest.tailCalls).toEqual([
			{ durableSessionId: "same-id", profileId: "travel", limit: 75 },
		]);
	});

	test("rejects old manager revision, resume, and event access after the connection is rebound", async () => {
		let installedManagerId = "manager-a";
		const now = new Date();
		for (const [index, managerId] of ["manager-a", "manager-b"].entries()) {
			getDb()
				.insert(schema.crossRepoOrchestrators)
				.values({
					id: managerId,
					name: managerId,
					workDir: `/tmp/${managerId}`,
					agentKind: "external",
					status: "idle",
					sortOrder: index,
					kind: "external",
					tokenHash: `${index + 4}`.repeat(64),
					accessScope: "all",
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => installedManagerId,
		});
		await service.connect(connectionId);
		const revision = new Deferred<{
			durableSessionId: string;
			latestMessageId: string;
			latestMessageAt: number;
			latestMessageIdIsStable: boolean;
		}>();
		rest.getSessionRevision = () => revision.promise;
		const resumed = new Deferred<unknown>();
		client.responses.set("session.resume", [resumed.promise]);
		const oldRequest = service.historyRevision(connectionId, "stored-1", "work", "manager-a");
		const oldResume = service.resume(connectionId, "stored-1", "work", "manager-a");
		const oldRequestResult = oldRequest.catch((error: unknown) => error);
		const oldResumeResult = oldResume.catch((error: unknown) => error);
		await waitFor(
			() => client.requests.some((request) => request.method === "session.resume"),
			"old manager resume did not start"
		);

		installedManagerId = "manager-b";
		await service.connect(connectionId);
		revision.resolve({
			durableSessionId: "stored-1",
			latestMessageId: "old-manager-message",
			latestMessageAt: 2_000,
			latestMessageIdIsStable: true,
		});
		resumed.resolve({
			session_id: "runtime-old-manager",
			session_key: "stored-1",
			profile: "work",
		});

		const [oldRequestError, oldResumeError] = await Promise.all([
			oldRequestResult,
			oldResumeResult,
		]);
		expect(oldRequestError).toBeInstanceOf(Error);
		expect(oldResumeError).toBeInstanceOf(Error);
		expect((oldRequestError as Error).message).toContain("connection cancelled");
		expect((oldResumeError as Error).message).toContain("connection cancelled");
		await expect(
			service.historyRevision(connectionId, "stored-1", "work", "manager-a")
		).rejects.toThrow("connection cancelled");
		await expect(service.resume(connectionId, "stored-1", "work", "manager-a")).rejects.toThrow(
			"connection cancelled"
		);
		expect(() => service.events(connectionId, 0, "manager-a")).toThrow("connection cancelled");
	});

	test("persists Agents-created admission under the connection's resolved manager", async () => {
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: "agents-owner",
				name: "Agents owner",
				workDir: "/tmp/agents-owner",
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: "d".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		saveHermesConnection(
			{
				id: connectionId,
				label: "Local stock Hermes",
				baseUrl: "http://127.0.0.1:9119",
				profileId: "work",
				managerId: "agents-owner",
			},
			vault
		);
		rest.sessions = [];
		client.responses.set("session.create", [
			{
				session_id: "runtime-created",
				stored_session_id: "durable-created",
				profile: "work",
			},
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }]);
		await service.connect(connectionId);

		await service.create(connectionId, { initialPrompt: "Own this session", profileId: "work" });

		expect(listHermesSessionAdmissions("agents-owner")).toEqual([
			expect.objectContaining({
				profileId: "work",
				durableSessionId: "durable-created",
				reason: "agents",
				sourcePlatform: "superiorswarm",
			}),
		]);
	});

	test("archives and unarchives only through Hermes, then reconciles the canonical catalog", async () => {
		admitAgentSession("managed-session");
		rest.sessions = [{ ...session("managed-session"), source: "superiorswarm", origin: null }];
		await service.connect(connectionId);

		const archived = await service.setSessionArchived(
			connectionId,
			"work",
			"managed-session",
			true
		);
		expect(rest.archiveCalls).toEqual([
			{ durableSessionId: "managed-session", profileId: "work", archived: true },
		]);
		expect(archived.sessions).toEqual([
			expect.objectContaining({ id: "managed-session", archived: true }),
		]);

		const open = await service.setSessionArchived(connectionId, "work", "managed-session", false);
		expect(rest.archiveCalls.at(-1)).toEqual({
			durableSessionId: "managed-session",
			profileId: "work",
			archived: false,
		});
		expect(open.sessions).toEqual([
			expect.objectContaining({ id: "managed-session", archived: false }),
		]);
		expect(rest.listCalls).toBe(5);
	});

	test("overlays durable names and tags without changing continuation identity or resume params", async () => {
		admitAgentSession("stored-1");
		rest.sessions = [
			{
				...session("stored-1"),
				title: "Generated title",
				generatedTitle: "Generated title",
				source: "superiorswarm",
				origin: null,
			},
		];
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [historyMessage("existing-message")],
		});
		client.responses.set("session.resume", [
			{
				session_id: "runtime-resumed",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "complete",
			},
		]);

		const initial = await service.connect(connectionId);
		expect(initial.sessions[0]).toMatchObject({
			title: "Generated title",
			generatedTitle: "Generated title",
			titleSource: "generated",
			tags: [],
			metadataRevision: 0,
		});
		expect(
			await service.setSessionTitle(connectionId, "work", "stored-1", "  Release plan  ", 0)
		).toMatchObject({ customTitle: "Release plan", tags: [], revision: 1 });
		expect(
			await service.setSessionTags(
				connectionId,
				"work",
				"stored-1",
				[" ready ", "customer report", "ready"],
				1
			)
		).toMatchObject({
			tags: [
				expect.objectContaining({ name: "ready" }),
				expect.objectContaining({ name: "customer report" }),
			],
			revision: 2,
		});
		expect(
			await service.addSessionTag(connectionId, "work", "stored-1", "follow up")
		).toMatchObject({
			tags: [
				expect.objectContaining({ name: "ready" }),
				expect.objectContaining({ name: "customer report" }),
				expect.objectContaining({ name: "follow up" }),
			],
			revision: 3,
		});
		expect(
			await service.removeSessionTag(connectionId, "work", "stored-1", " customer report ")
		).toMatchObject({
			tags: [
				expect.objectContaining({ name: "ready" }),
				expect.objectContaining({ name: "follow up" }),
			],
			revision: 4,
		});

		rest.sessions = [
			{
				...session("stored-1"),
				title: "Regenerated backend title",
				generatedTitle: "Regenerated backend title",
				source: "superiorswarm",
				origin: null,
			},
		];
		expect((await service.catalog(connectionId)).sessions[0]).toMatchObject({
			title: "Release plan",
			generatedTitle: "Regenerated backend title",
			titleSource: "custom",
			tags: [
				expect.objectContaining({ name: "ready" }),
				expect.objectContaining({ name: "follow up" }),
			],
			metadataRevision: 4,
		});
		await expect(
			service.setSessionTitle(connectionId, "work", "stored-1", "Stale rename", 2)
		).rejects.toThrow("Refresh and try again");

		const resumed = await service.resume(connectionId, "stored-1", "work");
		expect(resumed).toMatchObject({
			durableSessionId: "stored-1",
			runtimeSessionId: "runtime-resumed",
			history: { durableSessionId: "stored-1" },
		});
		expect(client.requests.find((request) => request.method === "session.resume")).toEqual({
			method: "session.resume",
			params: {
				session_id: "stored-1",
				profile: "work",
				source: "superiorswarm",
				omit_messages: false,
			},
		});
		expect(JSON.stringify(client.requests)).not.toContain("Release plan");
		expect(JSON.stringify(client.requests)).not.toContain("follow up");
	});

	test("rejects metadata mutation for a session outside the exact connected catalog identity", async () => {
		admitAgentSession("same-session", "work");
		rest.sessions = [
			{ ...session("same-session"), profileId: "work", source: "superiorswarm", origin: null },
		];
		await service.connect(connectionId);

		await expect(
			service.setSessionTitle(connectionId, "personal", "same-session", "Wrong profile", 0)
		).rejects.toThrow("was not found");
		await expect(
			service.addSessionTag(connectionId, "work", "missing-session", "wrong session")
		).rejects.toThrow("was not found");
		expect(getDb().select().from(schema.hermesSessionMetadata).all()).toEqual([]);
	});

	test("manages reusable tag definitions and assignments through exact catalog identity", async () => {
		admitAgentSession("stored-1");
		rest.sessions = [
			{ ...session("stored-1"), profileId: "work", source: "superiorswarm", origin: null },
		];
		await service.connect(connectionId);

		const upserted = await service.upsertTagDefinition(
			connectionId,
			"work",
			"stored-1",
			"Review",
			"amber"
		);
		expect(upserted).toEqual({
			created: true,
			definition: expect.objectContaining({ name: "Review", color: "amber", revision: 0 }),
		});
		expect(await service.listTagDefinitions(connectionId, "work", "stored-1", "rev")).toEqual([
			expect.objectContaining({ id: upserted.definition.id }),
		]);
		expect(
			await service.assignTagDefinition(connectionId, "work", "stored-1", upserted.definition.id)
		).toMatchObject({
			tags: [expect.objectContaining({ id: upserted.definition.id, color: "amber" })],
			revision: 1,
		});
		expect(
			await service.updateTagDefinition(connectionId, "work", "stored-1", upserted.definition.id, {
				name: "Reviewed",
				color: "green",
				expectedRevision: 0,
			})
		).toMatchObject({ name: "Reviewed", color: "green", revision: 1 });
		expect(
			await service.unassignTagDefinition(connectionId, "work", "stored-1", upserted.definition.id)
		).toMatchObject({ tags: [], revision: 2 });
		expect(
			await service.deleteTagDefinition(connectionId, "work", "stored-1", upserted.definition.id, 1)
		).toEqual({ detachedSessionCount: 0 });

		await expect(
			service.listTagDefinitions(connectionId, "personal", "stored-1", "")
		).rejects.toThrow("was not found");
	});

	test("uses profile plus durable ID for mutations when profiles collide", async () => {
		admitAgentSession("same-session", "work");
		admitAgentSession("same-session", "personal");
		rest.sessions = [
			{ ...session("same-session"), profileId: "work", source: "superiorswarm", origin: null },
			{
				...session("same-session"),
				profileId: "personal",
				source: "superiorswarm",
				origin: null,
			},
		];
		await service.connect(connectionId);

		const catalog = await service.setSessionArchived(
			connectionId,
			"personal",
			"same-session",
			true
		);

		expect(rest.archiveCalls).toEqual([
			{ durableSessionId: "same-session", profileId: "personal", archived: true },
		]);
		expect(catalog.sessions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "same-session", profileId: "work", archived: false }),
				expect.objectContaining({ id: "same-session", profileId: "personal", archived: true }),
			])
		);
	});

	test("fails closed when a legacy runtime call omits a colliding session profile", async () => {
		admitAgentSession("same-session", "work");
		admitAgentSession("same-session", "personal");
		rest.sessions = [
			{ ...session("same-session"), profileId: "work", source: "superiorswarm", origin: null },
			{
				...session("same-session"),
				profileId: "personal",
				source: "superiorswarm",
				origin: null,
			},
		];
		await service.connect(connectionId);

		await expect(service.origin(connectionId, "same-session")).rejects.toThrow(
			"profile is ambiguous"
		);
		await expect(service.historyRevision(connectionId, "same-session")).rejects.toThrow(
			"profile is ambiguous"
		);
		await expect(service.historyTail(connectionId, "same-session")).rejects.toThrow(
			"profile is ambiguous"
		);
		expect(rest.revisionCalls).toEqual([]);
		expect(rest.tailCalls).toEqual([]);
	});

	test("deletion cleanup preserves the colliding profile's runtime maps", async () => {
		admitAgentSession("same-session", "work");
		admitAgentSession("same-session", "personal");
		rest.sessions = [
			{ ...session("same-session"), profileId: "work", source: "superiorswarm", origin: null },
			{
				...session("same-session"),
				profileId: "personal",
				source: "superiorswarm",
				origin: null,
			},
		];
		client.responses.set("session.resume", [
			{
				session_id: "runtime-work",
				session_key: "same-session",
				profile: "work",
				running: false,
				status: "complete",
			},
			{
				session_id: "runtime-personal",
				session_key: "same-session",
				profile: "personal",
				running: false,
				status: "complete",
			},
			{
				session_id: "runtime-work-fresh",
				session_key: "same-session",
				profile: "work",
				running: false,
				status: "complete",
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "same-session", "work");
		await service.resume(connectionId, "same-session", "personal");

		const result = await service.deleteSession(connectionId, "work", "same-session", true);
		await expect(service.interrupt(connectionId, "same-session", "personal")).resolves.toEqual({
			ok: true,
		});

		expect(result.catalog?.sessions).toEqual([
			expect.objectContaining({ id: "same-session", profileId: "personal" }),
		]);
		expect(client.requests.at(-1)).toEqual({
			method: "session.interrupt",
			params: { session_id: "runtime-personal" },
		});
	});

	test("refreshes both canonical and runtime activity and fails closed without idle proof", async () => {
		admitAgentSession("fresh-guard");
		rest.sessions = [{ ...session("fresh-guard"), source: "superiorswarm", origin: null }];
		await service.connect(connectionId);
		rest.sessions = [
			{
				...session("fresh-guard"),
				source: "superiorswarm",
				origin: null,
				running: true,
				busy: true,
			},
		];

		await expect(service.deleteSession(connectionId, "work", "fresh-guard", true)).rejects.toThrow(
			"active turn"
		);
		expect(rest.listCalls).toBe(2);
		expect(rest.deleteCalls).toEqual([]);

		rest.sessions = [{ ...session("fresh-guard"), source: "superiorswarm", origin: null }];
		await expect(service.deleteSession(connectionId, "work", "fresh-guard", true)).rejects.toThrow(
			"could not prove that the session is idle"
		);
		expect(rest.deleteCalls).toEqual([]);
	});

	test("returns committed deletion when reconciliation fails and never repeats DELETE", async () => {
		admitAgentSession("committed-delete");
		rest.sessions = [{ ...session("committed-delete"), source: "superiorswarm", origin: null }];
		client.responses.set("session.resume", [
			{
				session_id: "runtime-committed-delete",
				session_key: "committed-delete",
				profile: "work",
				running: false,
				status: "complete",
			},
		]);
		await service.connect(connectionId);
		rest.failCatalogRefreshAfterDelete = true;

		const result = await service.deleteSession(connectionId, "work", "committed-delete", true);

		expect(result).toEqual({
			committed: true,
			catalog: null,
			reconciliationRequired: true,
		});
		expect(rest.deleteCalls).toEqual([{ durableSessionId: "committed-delete", profileId: "work" }]);
		expect(await service.catalog(connectionId)).toEqual(expect.objectContaining({ sessions: [] }));
		expect(rest.deleteCalls).toHaveLength(1);
	});

	test("blocks permanent deletion for a live turn and for unresolved interactions", async () => {
		admitAgentSession("live-session");
		admitAgentSession("pending-session");
		rest.sessions = [
			{ ...session("live-session"), source: "superiorswarm", origin: null },
			{ ...session("pending-session"), source: "superiorswarm", origin: null },
		];
		client.responses.set("session.resume", [
			{
				session_id: "runtime-live",
				session_key: "live-session",
				profile: "work",
				running: true,
				status: "streaming",
			},
			{
				session_id: "runtime-pending",
				session_key: "pending-session",
				profile: "work",
				running: true,
				status: "waiting_for_user",
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "live-session");
		await service.resume(connectionId, "pending-session");
		client.emit({
			type: "approval.request",
			runtimeSessionId: "runtime-pending",
			requestId: "approval-pending",
			text: "Allow this command?",
		});

		await expect(service.deleteSession(connectionId, "work", "live-session", true)).rejects.toThrow(
			"active turn"
		);
		await expect(
			service.deleteSession(connectionId, "work", "pending-session", true)
		).rejects.toThrow("unresolved approval or clarification");
		expect(rest.deleteCalls).toEqual([]);
	});

	test("requires confirmation, deletes canonically, and cleans only owned session resources", async () => {
		const now = new Date();
		for (const [index, managerId] of ["owning-manager", "other-manager"].entries()) {
			getDb()
				.insert(schema.crossRepoOrchestrators)
				.values({
					id: managerId,
					name: managerId,
					workDir: `/tmp/${managerId}`,
					agentKind: "external",
					status: "idle",
					sortOrder: index,
					kind: "external",
					tokenHash: `${index + 7}`.repeat(64),
					accessScope: "all",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			admitHermesSession({
				managerId,
				metadata: {
					schemaVersion: 1,
					durableSessionId: "delete-me",
					profileId: "work",
					sourcePlatform: "slack",
					isCron: false,
				},
				reason: "mcp",
			});
		}
		saveHermesConnection(
			{
				id: connectionId,
				label: "Local stock Hermes",
				baseUrl: "http://127.0.0.1:9119",
				profileId: "work",
				managerId: "owning-manager",
			},
			vault
		);
		rest.sessions = [{ ...session("delete-me"), handover: false }];
		linkHermesWorkspace({
			connectionId,
			profileId: "work",
			hermesSessionId: "delete-me",
			workspaceId: "workspace-owned-link",
			source: "manual",
		});
		linkHermesWorkspace({
			connectionId,
			profileId: "personal",
			hermesSessionId: "delete-me",
			workspaceId: "workspace-owned-link",
			source: "manual",
		});
		saveHermesOriginLink({
			connectionId,
			profileId: "work",
			hermesSessionId: "delete-me",
			originFingerprint: "slack-origin",
			openUrl: "https://workspace.slack.com/archives/C12345/p1234567890000000",
		});
		for (const [profileId, hermesSessionId] of [
			["work", "delete-me"],
			["personal", "delete-me"],
			["work", "keep-me"],
		] as const) {
			prepareHermesOriginReport({
				connectionId,
				profileId,
				hermesSessionId,
				messageId: "message-1",
				content: `${profileId}:${hermesSessionId}`,
				destinationFingerprint: `destination:${profileId}:${hermesSessionId}`,
			});
		}
		await service.connect(connectionId);
		client.responses.set("session.resume", [
			{
				session_id: "runtime-delete-me",
				session_key: "delete-me",
				profile: "work",
				running: false,
				status: "complete",
			},
		]);
		await service.resume(connectionId, "delete-me");

		await expect(service.deleteSession(connectionId, "work", "delete-me", false)).rejects.toThrow(
			"confirmation"
		);
		client.responses.set("session.resume", [
			{
				session_id: "runtime-delete-me-fresh",
				session_key: "delete-me",
				profile: "work",
				running: false,
				status: "complete",
			},
		]);
		const result = await service.deleteSession(connectionId, "work", "delete-me", true);

		expect(rest.deleteCalls).toEqual([{ durableSessionId: "delete-me", profileId: "work" }]);
		expect(result).toMatchObject({ committed: true, reconciliationRequired: false });
		expect(result.catalog?.sessions).toEqual([]);
		expect(listHermesWorkspaceLinks(connectionId, "work", "delete-me")).toEqual([]);
		expect(listHermesWorkspaceLinks(connectionId, "personal", "delete-me")).toEqual([
			expect.objectContaining({
				profileId: "personal",
				hermesSessionId: "delete-me",
				workspaceId: "workspace-owned-link",
			}),
		]);
		expect(
			getDb()
				.select()
				.from(schema.hermesOriginLinks)
				.where(eq(schema.hermesOriginLinks.hermesSessionId, "delete-me"))
				.all()
		).toEqual([]);
		expect(listHermesSessionAdmissions("owning-manager")).toEqual([]);
		expect(listHermesSessionAdmissions("other-manager")).toEqual([
			expect.objectContaining({ durableSessionId: "delete-me" }),
		]);
		expect(listHermesOriginReports(connectionId, "work", "delete-me")).toEqual([]);
		expect(listHermesOriginReports(connectionId, "personal", "delete-me")).toHaveLength(1);
		expect(listHermesOriginReports(connectionId, "work", "keep-me")).toHaveLength(1);
		expect(rest.transcriptCalls).toEqual([{ durableSessionId: "delete-me", profileId: "work" }]);
		await expect(service.interrupt(connectionId, "delete-me")).rejects.toThrow("Resume");
	});

	test("resolves and persists the manager identity for a live external Telegram session", async () => {
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: "external-hermes-manager",
				name: "External Hermes",
				workDir: "/tmp/external-hermes-manager",
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: "c".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		admitHermesSession({
			managerId: "external-hermes-manager",
			metadata: {
				schemaVersion: 1,
				durableSessionId: "live-telegram-dm-topic",
				profileId: "default",
				sourcePlatform: "telegram",
				isCron: false,
			},
			reason: "mcp",
		});
		rest.sessions = [
			{
				...session("live-telegram-dm-topic"),
				profileId: "default",
				source: "telegram",
				handover: false,
				origin: {
					platform: "telegram",
					source: "telegram",
					displayLabel: "Telegram DM topic",
					workspaceLabel: null,
					accountLabel: null,
					chatLabel: "Telegram DM",
					channelLabel: null,
					threadLabel: null,
					hasThread: true,
					canOpenThread: false,
					canReport: false,
				},
			},
			{
				...session("unrelated-telegram"),
				profileId: "default",
				source: "telegram",
			},
		];
		service.shutdown();
		const resolvedConnectionIds: string[] = [];
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: (connection) => {
				resolvedConnectionIds.push(connection.id);
				return "external-hermes-manager";
			},
		});

		const catalog = await service.connect(connectionId);

		expect(catalog.sessions.map((item) => item.id)).toEqual(["live-telegram-dm-topic"]);
		expect(catalog.sessions[0]).toMatchObject({
			source: "telegram",
			admissionReason: "mcp",
			origin: { platform: "telegram", hasThread: true },
		});
		expect(resolvedConnectionIds).toEqual([connectionId]);
		expect(
			listHermesConnections(vault).find((connection) => connection.id === connectionId)?.managerId
		).toBe("external-hermes-manager");
		expect(
			listHermesConnections(vault).find((connection) => connection.id === connectionId)
				?.managerBindingMode
		).toBe("auto");
	});

	test("revalidates auto-detected loopback ownership on every connect and fails closed", async () => {
		const now = new Date();
		for (const [index, managerId] of ["manager-a", "manager-b"].entries()) {
			getDb()
				.insert(schema.crossRepoOrchestrators)
				.values({
					id: managerId,
					name: managerId,
					workDir: `/tmp/${managerId}`,
					agentKind: "external",
					status: "idle",
					sortOrder: index,
					kind: "external",
					tokenHash: `${index + 1}`.repeat(64),
					accessScope: "all",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			admitHermesSession({
				managerId,
				metadata: {
					schemaVersion: 1,
					durableSessionId: `session-${managerId}`,
					profileId: "work",
					sourcePlatform: "telegram",
					isCron: false,
				},
				reason: "mcp",
			});
		}
		rest.sessions = [session("session-manager-a"), session("session-manager-b")];
		let installedManagerId: string | null = "manager-a";
		let resolutionCount = 0;
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "dashboard-secret",
			externalManagerIdResolver: () => {
				resolutionCount++;
				return installedManagerId;
			},
		});

		expect((await service.connect(connectionId)).sessions.map((item) => item.id)).toEqual([
			"session-manager-a",
		]);
		installedManagerId = "manager-b";
		expect((await service.connect(connectionId)).sessions.map((item) => item.id)).toEqual([
			"session-manager-b",
		]);
		expect(
			listHermesConnections(vault).find((connection) => connection.id === connectionId)
		).toMatchObject({ managerId: "manager-b", managerBindingMode: "auto" });
		expect(resolutionCount).toBe(2);

		installedManagerId = null;
		expect((await service.connect(connectionId)).sessions).toEqual([]);
		expect(resolutionCount).toBe(3);
		expect(
			listHermesConnections(vault).find((connection) => connection.id === connectionId)
		).toMatchObject({ managerId: null, managerBindingMode: "auto" });
		expect(JSON.stringify(service.getState(connectionId))).not.toContain("dashboard-secret");
	});

	test("keeps an explicitly selected loopback manager isolated from auto-detection", async () => {
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: "manual-manager",
				name: "Manual manager",
				workDir: "/tmp/manual-manager",
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: "e".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		saveHermesConnection(
			{
				id: connectionId,
				label: "Local stock Hermes",
				baseUrl: "http://127.0.0.1:9119",
				profileId: "work",
				managerId: "manual-manager",
			},
			vault
		);
		let resolverCalled = false;
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => {
				resolverCalled = true;
				return null;
			},
		});

		await service.connect(connectionId);

		expect(resolverCalled).toBe(false);
		expect(listHermesConnections(vault).find((item) => item.id === connectionId)).toMatchObject({
			managerId: "manual-manager",
			managerBindingMode: "manual",
		});
	});

	test("fails closed when an ambiguous legacy manager no longer matches the installed identity", async () => {
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: "legacy-manager",
				name: "Legacy manager",
				workDir: "/tmp/legacy-manager",
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: "f".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		saveHermesConnection(
			{
				id: connectionId,
				label: "Legacy loopback Hermes",
				baseUrl: "http://127.0.0.1:9119",
				profileId: "work",
				managerId: "legacy-manager",
			},
			vault
		);
		getDb()
			.update(schema.hermesConnections)
			.set({ managerBindingMode: null })
			.where(eq(schema.hermesConnections.id, connectionId))
			.run();
		let dashboardTokenRead = false;
		service.shutdown();
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => {
				dashboardTokenRead = true;
				return "must-not-leak";
			},
			externalManagerIdResolver: () => "new-installed-manager",
		});

		await expect(service.connect(connectionId)).rejects.toThrow("ownership is ambiguous");
		expect(dashboardTokenRead).toBe(false);
		expect(client.connectCalls).toBe(0);
		expect(listHermesConnections(vault).find((item) => item.id === connectionId)).toMatchObject({
			managerId: "legacy-manager",
			managerBindingMode: null,
		});
		expect(JSON.stringify(service.getState(connectionId))).not.toContain("must-not-leak");
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

	test("builds the managed session inbox only from structural local origin and matching manager admissions", async () => {
		service.shutdown();
		const managed = ensureHermesLocalConnection({ profileId: "default" }, vault);
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: "managed-hermes-manager",
				name: "Managed Hermes",
				workDir: "/tmp/managed-hermes-manager",
				agentKind: "external",
				status: "idle",
				sortOrder: 0,
				kind: "external",
				tokenHash: "b".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		for (const [durableSessionId, profileId, sourcePlatform, reason] of [
			["local-created", "default", "superiorswarm", "agents"],
			["mcp-telegram", "work", "telegram", "mcp"],
			["explicit-slack", "personal", "slack", "handover"],
		] as const) {
			admitHermesSession({
				managerId: "managed-hermes-manager",
				metadata: {
					schemaVersion: 1,
					durableSessionId,
					profileId,
					sourcePlatform,
					isCron: false,
				},
				reason,
			});
		}
		getDb()
			.insert(schema.hermesSessionWorkspaces)
			.values({
				id: "unrelated-link",
				connectionId: managed.id,
				hermesSessionId: "linked-but-unadmitted",
				workspaceId: "missing-workspace-is-retained-structurally",
				source: "manual",
				linkedAt: now,
			})
			.run();
		const catalogSession = (
			id: string,
			profileId: string,
			source: string,
			isCron = false
		): HermesSessionSummary => ({
			...session(id),
			profileId,
			source,
			isCron,
			handover: false,
			admissionReason: null,
			origin:
				source === "superiorswarm"
					? null
					: {
							platform: source,
							source,
							displayLabel: source,
							workspaceLabel: null,
							accountLabel: null,
							chatLabel: null,
							channelLabel: null,
							threadLabel: null,
							hasThread: false,
							canOpenThread: false,
							canReport: false,
						},
		});
		rest.sessions = [
			catalogSession("local-created", "default", "superiorswarm"),
			catalogSession("mcp-telegram", "work", "telegram"),
			catalogSession("explicit-slack", "personal", "slack"),
			catalogSession("unrelated-telegram", "work", "telegram"),
			catalogSession("unrelated-slack", "work", "slack"),
			catalogSession("unrelated-cli", "work", "cli"),
			catalogSession("unrelated-api", "work", "api_server"),
			catalogSession("cron", "work", "cron", true),
			catalogSession("linked-but-unadmitted", "work", "desktop"),
		];
		service = new HermesRuntimeService({
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			localBackendManager: {
				ensure: async () => ({
					baseUrl: "http://127.0.0.1:54321",
					profileId: "default",
					token: "managed-token",
					managerId: "managed-hermes-manager",
				}),
				subscribeRuntimeInvalidated: () => () => undefined,
				shutdown: () => undefined,
			},
		});

		const catalog = await service.connect(managed.id);

		expect(
			listHermesConnections(vault).find((connection) => connection.id === managed.id)
		).toMatchObject({ managerId: "managed-hermes-manager" });
		expect(catalog.sessions.map((item) => item.id)).toEqual([
			"local-created",
			"mcp-telegram",
			"explicit-slack",
		]);
		expect(catalog.sessions.find((item) => item.id === "mcp-telegram")).toMatchObject({
			handover: false,
			admissionReason: "mcp",
			origin: { platform: "telegram" },
		});
		expect(catalog.sessions.find((item) => item.id === "explicit-slack")).toMatchObject({
			handover: true,
			admissionReason: "handover",
			origin: { platform: "slack" },
		});
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
			view: "durable",
			messages: [
				{
					id: "message-1",
					canonicalMessageId: "message-1",
					compactionGeneration: 0,
					active: true,
					compacted: false,
					displayKind: null,
					compactionSummaryType: null,
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
			initialPrompt: "Investigate ticket SUP-42 and fix the failing release build",
			cwd: "/tmp/worktree",
		} as { initialPrompt: string });

		expect(created).toMatchObject({
			runtimeSessionId: "runtime-new",
			durableSessionId: "stored-new",
			persisted: false,
		});
		expect(await service.history(connectionId, created.durableSessionId)).toEqual({
			durableSessionId: "stored-new",
			view: "active",
			messages: [
				expect.objectContaining({
					role: "user",
					text: "Investigate ticket SUP-42 and fix the failing release build",
				}),
			],
		});
		await waitFor(
			() => client.requests.some((request) => request.method === "prompt.submit"),
			"initial topic was not submitted"
		);
		expect(client.requests).toEqual([
			{
				method: "session.create",
				params: {
					title: "Investigate ticket SUP-42 and fix the failing release build",
					source: "superiorswarm",
					profile: "work",
				},
			},
			{
				method: "prompt.submit",
				params: {
					session_id: "runtime-new",
					text: "Investigate ticket SUP-42 and fix the failing release build",
					idempotency_key: expect.any(String),
				},
			},
		]);
		const queued = await service.submitFollowUp(
			connectionId,
			created.durableSessionId,
			"Queued continuation",
			[],
			"work"
		);
		expect(queued.disposition).toBe("queued");
		expect(service.followUps(connectionId, created.durableSessionId, "work")).toEqual([
			expect.objectContaining({ text: "Queued continuation", status: "queued" }),
		]);
		expect(JSON.stringify(client.requests)).not.toContain("claim");
		expect(rest.transcriptCalls).toEqual([]);
	});

	test("auto-links a trusted create-worktree artifact to the durable task session", async () => {
		const now = new Date();
		getDb()
			.insert(schema.projects)
			.values({
				id: "project-artifact",
				name: "Artifact App",
				repoPath: "/repos/artifact-app",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(schema.worktrees)
			.values({
				id: "worktree-artifact",
				projectId: "project-artifact",
				path: "/repos/artifact-app-worktrees/feat/task",
				branch: "feat/task",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(schema.workspaces)
			.values({
				id: "workspace-artifact",
				projectId: "project-artifact",
				type: "worktree",
				name: "feat/task",
				worktreeId: "worktree-artifact",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		client.responses.set("session.create", [
			{ session_id: "runtime-task", stored_session_id: "durable-task", profile: "work" },
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }]);
		await service.connect(connectionId);
		await service.create(connectionId, { initialPrompt: "Change every relevant repository" });

		client.emit({
			type: "tool.result",
			runtimeSessionId: "runtime-task",
			workspaceArtifacts: [
				{
					kind: "superiorswarm.workspace.created",
					workspaceId: "workspace-artifact",
					projectId: "project-artifact",
					branch: "feat/task",
					worktreePath: "/repos/artifact-app-worktrees/feat/task",
				},
			],
		});

		expect(listHermesWorkspaceLinks(connectionId, "work", "durable-task")).toEqual([
			expect.objectContaining({
				hermesSessionId: "durable-task",
				workspaceId: "workspace-artifact",
				source: "tool-artifact",
			}),
		]);
		expect(listHermesWorkspaceLinks(connectionId, "work", "runtime-task")).toEqual([]);
	});

	test("consolidates selected session aliases onto the canonical durable workspace link", async () => {
		const now = new Date();
		getDb()
			.insert(schema.projects)
			.values({
				id: "project-alias",
				name: "Alias App",
				repoPath: "/repos/alias-app",
				defaultBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(schema.worktrees)
			.values({
				id: "worktree-alias",
				projectId: "project-alias",
				path: "/repos/alias-app-worktrees/feat/task",
				branch: "feat/task",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(schema.workspaces)
			.values({
				id: "workspace-alias",
				projectId: "project-alias",
				type: "worktree",
				name: "feat/task",
				worktreeId: "worktree-alias",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		rest.sessions = [session("session-tip")];
		rest.histories.set(
			"session-tip",
			compressedHistory("session-tip", "session-root", [
				historyMessage("artifact-message", {
					workspaceArtifacts: [
						{
							kind: "superiorswarm.workspace.created",
							workspaceId: "workspace-alias",
							projectId: "project-alias",
							branch: "feat/task",
							worktreePath: "/repos/alias-app-worktrees/feat/task",
						},
					],
				}),
			])
		);
		linkHermesWorkspace({
			connectionId,
			profileId: "work",
			hermesSessionId: "session-tip",
			workspaceId: "workspace-alias",
			source: "tool-artifact",
		});
		linkHermesWorkspace({
			connectionId,
			profileId: "personal",
			hermesSessionId: "session-tip",
			workspaceId: "workspace-alias",
			source: "manual",
		});
		await service.connect(connectionId);

		const history = await service.history(connectionId, "session-tip");

		expect(history.durableSessionId).toBe("session-root");
		expect(listHermesWorkspaceLinks(connectionId, "work", "session-root")).toEqual([
			expect.objectContaining({
				hermesSessionId: "session-root",
				workspaceId: "workspace-alias",
				source: "tool-artifact",
			}),
		]);
		expect(listHermesWorkspaceLinks(connectionId, "work", "session-tip")).toEqual([]);
		expect(listHermesWorkspaceLinks(connectionId, "personal", "session-tip")).toEqual([
			expect.objectContaining({
				profileId: "personal",
				hermesSessionId: "session-tip",
				workspaceId: "workspace-alias",
			}),
		]);
		expect(listHermesWorkspaceLinks(connectionId, "personal", "session-root")).toEqual([]);
		expect(
			getDb()
				.select()
				.from(schema.hermesSessionWorkspaces)
				.where(eq(schema.hermesSessionWorkspaces.connectionId, connectionId))
				.all()
		).toHaveLength(2);
	});

	test("projects a stock lineage child without migrating root-scoped ownership", async () => {
		const now = new Date();
		getDb()
			.insert(schema.crossRepoOrchestrators)
			.values({
				id: "other-lineage-manager",
				name: "Other lineage manager",
				workDir: "/tmp/other-lineage-manager",
				agentKind: "external",
				status: "idle",
				sortOrder: 1,
				kind: "external",
				tokenHash: "9".repeat(64),
				accessScope: "all",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		for (const [managerId, profileId, reason] of [
			[defaultManagerId, "work", "handover"],
			[defaultManagerId, "personal", "mcp"],
			["other-lineage-manager", "work", "mcp"],
		] as const) {
			admitHermesSession({
				managerId,
				metadata: {
					schemaVersion: 1,
					durableSessionId: "compression-parent",
					profileId,
					sourcePlatform: "slack",
					isCron: false,
				},
				reason,
			});
		}
		const otherConnectionId = saveHermesConnection(
			{
				label: "Other connection",
				baseUrl: "http://127.0.0.1:9120",
				profileId: "work",
				token: "other-secret",
			},
			vault
		).id;
		for (const [linkedConnectionId, profileId] of [
			[connectionId, "work"],
			[connectionId, "personal"],
			[otherConnectionId, "work"],
		] as const) {
			linkHermesWorkspace({
				connectionId: linkedConnectionId,
				profileId,
				hermesSessionId: "compression-parent",
				workspaceId: "lineage-workspace",
				source: "manual",
			});
		}
		for (const [linkedConnectionId, profileId, suffix] of [
			[connectionId, "work", "owned"],
			[connectionId, "personal", "personal"],
			[otherConnectionId, "work", "other"],
		] as const) {
			saveHermesOriginLink({
				connectionId: linkedConnectionId,
				profileId,
				hermesSessionId: "compression-parent",
				originFingerprint: `origin-${suffix}`,
				openUrl: `https://workspace.slack.com/archives/C12345/p123456789000000${suffix.length}`,
			});
			prepareHermesOriginReport({
				connectionId: linkedConnectionId,
				profileId,
				hermesSessionId: "compression-parent",
				messageId: "lineage-message",
				content: "Lineage report",
				destinationFingerprint: `destination-${suffix}`,
			});
		}
		getDb()
			.insert(schema.sessionState)
			.values({
				key: "selectedHermesSession",
				value: JSON.stringify({
					connectionId,
					profileId: "work",
					sessionId: "compression-parent",
				}),
			})
			.run();
		const parent = {
			...session("compression-parent"),
			title: "Shared title",
			source: "slack",
		};
		const child = {
			...parent,
			id: "compression-child",
			activeTipId: "compression-child",
			lineageRootId: "compression-parent",
		};
		const unrelatedDelegate = {
			...parent,
			id: "unrelated-delegate",
			activeTipId: "unrelated-delegate",
			lineageRootId: "unrelated-delegate",
		};
		rest.sessions = [child, unrelatedDelegate];
		rest.histories.set("compression-child", {
			durableSessionId: "compression-child",
			view: "active",
			messages: [],
		});
		await service.connect(connectionId);

		const history = await service.history(connectionId, "compression-parent", "work");
		const catalog = await service.catalog(connectionId);

		expect(history.durableSessionId).toBe("compression-child");
		expect(catalog.sessions.map((candidate) => candidate.id)).toEqual(["compression-child"]);
		expect(listHermesSessionAdmissions(defaultManagerId)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					profileId: "work",
					durableSessionId: "compression-parent",
					reason: "handover",
					sourcePlatform: "slack",
				}),
				expect.objectContaining({
					profileId: "personal",
					durableSessionId: "compression-parent",
					reason: "mcp",
				}),
			])
		);
		expect(listHermesSessionAdmissions(defaultManagerId)).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ durableSessionId: "compression-child" }),
				expect.objectContaining({ durableSessionId: "unrelated-delegate" }),
			])
		);
		expect(listHermesSessionAdmissions("other-lineage-manager")).toEqual([
			expect.objectContaining({
				profileId: "work",
				durableSessionId: "compression-parent",
				reason: "mcp",
			}),
		]);
		expect(listHermesWorkspaceLinks(connectionId, "work", "compression-parent")).toEqual([
			expect.objectContaining({ workspaceId: "lineage-workspace" }),
		]);
		expect(listHermesWorkspaceLinks(connectionId, "personal", "compression-parent")).toHaveLength(
			1
		);
		expect(listHermesWorkspaceLinks(otherConnectionId, "work", "compression-parent")).toHaveLength(
			1
		);
		expect(
			getHermesOriginLink({
				connectionId,
				profileId: "work",
				hermesSessionId: "compression-parent",
				originFingerprint: "origin-owned",
			})
		).toContain("/archives/C12345/");
		expect(
			getHermesOriginLink({
				connectionId,
				profileId: "work",
				hermesSessionId: "compression-child",
				originFingerprint: "origin-owned",
			})
		).toBeNull();
		expect(
			getHermesOriginLink({
				connectionId,
				profileId: "personal",
				hermesSessionId: "compression-parent",
				originFingerprint: "origin-personal",
			})
		).toContain("/archives/C12345/");
		expect(
			getHermesOriginLink({
				connectionId: otherConnectionId,
				profileId: "work",
				hermesSessionId: "compression-parent",
				originFingerprint: "origin-other",
			})
		).toContain("/archives/C12345/");
		expect(listHermesOriginReports(connectionId, "work", "compression-parent")).toHaveLength(1);
		expect(listHermesOriginReports(connectionId, "work", "compression-child")).toEqual([]);
		expect(listHermesOriginReports(connectionId, "personal", "compression-parent")).toHaveLength(1);
		expect(listHermesOriginReports(otherConnectionId, "work", "compression-parent")).toHaveLength(
			1
		);
		expect(
			getDb()
				.select({ value: schema.sessionState.value })
				.from(schema.sessionState)
				.where(eq(schema.sessionState.key, "selectedHermesSession"))
				.get()?.value
		).toBe(
			JSON.stringify({
				connectionId,
				profileId: "work",
				sessionId: "compression-parent",
			})
		);
	});

	test("rejects an unverified or mismatched durable identity without admitting title or source matches", async () => {
		admitAgentSession("admitted-parent");
		rest.sessions = [
			{ ...session("admitted-parent"), title: "Same", source: "superiorswarm", origin: null },
			{ ...session("lookalike-child"), title: "Same", source: "superiorswarm", origin: null },
		];
		rest.histories.set("admitted-parent", {
			durableSessionId: "lookalike-child",
			view: "durable",
			messages: [],
		});
		await service.connect(connectionId);

		await expect(service.history(connectionId, "admitted-parent", "work")).rejects.toThrow(
			"verified compression lineage"
		);
		expect(listHermesSessionAdmissions(defaultManagerId)).toEqual([
			expect.objectContaining({ durableSessionId: "admitted-parent" }),
		]);

		rest.histories.set("admitted-parent", compressedHistory("different-parent", "lookalike-child"));
		await expect(service.history(connectionId, "admitted-parent", "work")).rejects.toThrow(
			"verified compression lineage"
		);
		expect((await service.catalog(connectionId)).sessions.map((candidate) => candidate.id)).toEqual(
			["admitted-parent"]
		);
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
		const stagedImagePath = String(client.requests[1]?.params["path"]);
		const stagedPdfPath = String(client.requests[2]?.params["path"]);
		const stagedFilePath = String(client.requests[3]?.params["path"]);
		expect([stagedImagePath, stagedPdfPath, stagedFilePath]).not.toContain(fixture.imagePath);
		expect([stagedImagePath, stagedPdfPath, stagedFilePath]).not.toContain(fixture.pdfPath);
		expect([stagedImagePath, stagedPdfPath, stagedFilePath]).not.toContain(fixture.filePath);
		expect(await Bun.file(stagedImagePath).exists()).toBe(false);
		expect(await Bun.file(stagedPdfPath).exists()).toBe(false);
		expect(await Bun.file(stagedFilePath).exists()).toBe(false);
		const prompt = String(client.requests[4]?.params["text"]);
		expect(prompt).toContain("Review these files");
		expect(prompt).toContain("screen.png");
		expect(prompt).toContain("plan.pdf");
		expect(prompt).toContain("@file:.hermes/attachments/notes.txt");
		expect(prompt).not.toContain(fixture.directory);
		expect(prompt).not.toContain(stagedImagePath);
		expect(prompt).not.toContain(stagedPdfPath);
		expect(attachments.size).toBe(0);
	});

	test("reserves a session before deferred attachment resolution and releases it on failure", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.filePath]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-concurrent", session_key: "stored-1", profile: "work" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		const resolution = new Deferred<Awaited<ReturnType<HermesAttachmentStore["resolve"]>>>();
		let resolveCalls = 0;
		attachments.resolve = () => {
			resolveCalls++;
			return resolution.promise;
		};

		const first = service.submit(connectionId, "stored-1", "First", [selected?.handle ?? ""]);
		await waitFor(() => resolveCalls === 1, "attachment resolution did not start");
		const second = service.submit(connectionId, "stored-1", "Second");
		expect(resolveCalls).toBe(1);

		attachments.resolve = () => Promise.resolve([]);
		resolution.reject(new Error("selection failed"));
		await expect(first).rejects.toThrow("selection failed");
		await expect(second).resolves.toEqual({ ok: true });
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(1);
	});

	test("queues active-turn follow-ups and drains FIFO exactly once on authoritative completion", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-fifo", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-first" },
			{ status: "streaming", turn_id: "turn-second" },
			{ status: "streaming", turn_id: "turn-third" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "First", [], "work");

		const second = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Second",
			[],
			"work",
			"client-turn-second"
		);
		const duplicateSecond = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Second",
			[],
			"work",
			"client-turn-second"
		);
		const third = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Third",
			[],
			"work",
			"client-turn-third"
		);

		expect(second.disposition).toBe("queued");
		expect(duplicateSecond.followUp.id).toBe(second.followUp.id);
		expect(third.disposition).toBe("queued");
		expect(second.followUp.id).toBe("client-turn-second");
		expect(third.followUp.id).toBe("client-turn-third");
		expect(service.followUps(connectionId, "stored-1", "work").map((item) => item.text)).toEqual([
			"Second",
			"Third",
		]);

		client.emit({
			type: "message.complete",
			runtimeSessionId: "runtime-fifo",
			turnId: "turn-first",
			text: "First done",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"second follow-up did not drain"
		);
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-fifo",
			turnId: "turn-first",
		});
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);

		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-fifo",
			turnId: "turn-second",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 3,
			"third follow-up did not drain"
		);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params["text"])
		).toEqual(["First", "Second", "Third"]);
	});

	test("resnapshots an untagged stock terminal and advances the FIFO only after idle proof", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-stock-terminal",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
			},
			{
				session_id: "runtime-stock-terminal",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
				messages: [
					{ id: "user-current", role: "user", content: "Current" },
					{ id: "assistant-current", role: "assistant", content: "Done" },
				],
			},
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }, { status: "streaming" }]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Next", [], "work");

		client.emit({
			type: "message.complete",
			runtimeSessionId: "runtime-stock-terminal",
			turnId: null,
			text: "Done",
		});

		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"stock terminal reconciliation did not drain the next follow-up"
		);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params["text"])
		).toEqual(["Current", "Next"]);
		expect(client.requests.filter((request) => request.method === "session.resume")).toHaveLength(
			2
		);
	});

	test("keeps an interrupted turn active until its terminal event drains the continuation", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-interrupt", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			{ status: "streaming", turn_id: "turn-continuation" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Continue", [], "work");

		await service.interrupt(connectionId, "stored-1", "work");
		client.emit({
			type: "turn.cancelled",
			runtimeSessionId: "runtime-interrupt",
			turnId: "turn-current",
		});

		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"queued continuation did not drain after the interrupted turn ended"
		);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params["text"])
		).toEqual(["Current", "Continue"]);
	});

	test("migrates a compaction-time continuation queue FIFO and drains every item exactly once", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-compaction", session_key: "queue-parent", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			{ status: "streaming", turn_id: "turn-next-a" },
			{ status: "streaming", turn_id: "turn-next-b" },
		]);
		rest.histories.set("queue-parent", {
			durableSessionId: "queue-parent",
			view: "durable",
			messages: [],
		});
		await service.connect(connectionId);
		await service.resume(connectionId, "queue-parent", "work");
		await service.submit(connectionId, "queue-parent", "Current", [], "work");
		await service.submitFollowUp(connectionId, "queue-parent", "Next A", [], "work");
		await service.submitFollowUp(connectionId, "queue-parent", "Next B", [], "work");
		rest.histories.set("queue-parent", compressedHistory("queue-parent", "queue-child"));

		await service.history(connectionId, "queue-parent", "work");

		expect(service.followUps(connectionId, "queue-child", "work").map((item) => item.text)).toEqual(
			["Next A", "Next B"]
		);
		expect(
			service.followUps(connectionId, "queue-parent", "work").map((item) => item.text)
		).toEqual(["Next A", "Next B"]);
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-compaction",
			turnId: "turn-current",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"first canonical continuation did not drain"
		);
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-compaction",
			turnId: "turn-next-a",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 3,
			"second canonical continuation did not drain"
		);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params["text"])
		).toEqual(["Current", "Next A", "Next B"]);
	});

	test("cancels a migrated queued continuation through either canonical identity", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-cancel-compaction", session_key: "cancel-parent", profile: "work" },
		]);
		client.responses.set("prompt.submit", [{ status: "streaming", turn_id: "turn-current" }]);
		rest.histories.set("cancel-parent", {
			durableSessionId: "cancel-parent",
			view: "durable",
			messages: [],
		});
		await service.connect(connectionId);
		await service.resume(connectionId, "cancel-parent", "work");
		await service.submit(connectionId, "cancel-parent", "Current", [], "work");
		const queued = await service.submitFollowUp(
			connectionId,
			"cancel-parent",
			"Cancel after compaction",
			[],
			"work"
		);
		rest.histories.set("cancel-parent", compressedHistory("cancel-parent", "cancel-child"));
		await service.history(connectionId, "cancel-parent", "work");

		expect(
			service.cancelFollowUp(connectionId, "cancel-child", queued.followUp.id, "work")
		).toEqual({ ok: true });
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-cancel-compaction",
			turnId: "turn-current",
		});
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(1);
		expect(service.followUps(connectionId, "cancel-parent", "work")).toEqual([]);
	});

	test("ignores stale terminals from a retired physical parent binding after compression", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-stale-parent", session_key: "stale-parent", profile: "work" },
			{ session_id: "runtime-canonical-child", session_key: "stale-child", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			{ status: "streaming", turn_id: "turn-next" },
		]);
		rest.histories.set("stale-parent", compressedHistory("stale-parent", "stale-child"));
		await service.connect(connectionId);
		await service.resume(connectionId, "stale-parent", "work");
		await service.resume(connectionId, "stale-child", "work");
		await service.submit(connectionId, "stale-child", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stale-child", "Next", [], "work");

		await service.history(connectionId, "stale-parent", "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-stale-parent",
			turnId: "turn-current",
		});
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(1);

		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-canonical-child",
			turnId: "turn-current",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"canonical child terminal did not drain exactly once"
		);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params["text"])
		).toEqual(["Current", "Next"]);
	});

	test("reconciles a missed terminal from canonical history and suppresses its late live duplicate", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-history-terminal", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-history" },
			{ status: "streaming", turn_id: "turn-after-history" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "After history", [], "work");
		const normalizedHistory = await new HermesRestClient({
			baseUrl: "http://127.0.0.1:9119",
			profileId: "work",
			token: "test-token",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						view: "durable",
						session_id: "stored-1",
						messages: [
							{
								id: "canonical-user-history",
								role: "user",
								turn_id: "turn-history",
								content: "Current",
							},
							{
								id: "canonical-assistant-history",
								role: "assistant",
								turn_id: "turn-history",
								content: "Canonical answer",
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				),
		}).getTranscript("stored-1", "work");
		expect(normalizedHistory.messages.at(-1)?.status).toBeNull();
		rest.histories.set("stored-1", normalizedHistory);

		await service.history(connectionId, "stored-1", "work");
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"canonical terminal did not drain the continuation"
		);
		client.emit({
			type: "message.complete",
			runtimeSessionId: "runtime-history-terminal",
			turnId: "turn-history",
			text: "Canonical answer",
		});
		await Bun.sleep(5);

		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
		expect(
			service
				.events(connectionId, 0)
				.events.filter(
					(entry) =>
						entry.event.type === "message.complete" && entry.event.turnId === "turn-history"
				)
		).toEqual([]);
	});

	test("does not infer a statusless terminal from compaction, tool, or conflicting live evidence", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-history-guard", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-history-guard" },
			{ status: "streaming", turn_id: "turn-after-guard" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "After guarded history", [], "work");

		const visibleTerminal = historyMessage("guarded-visible", {
			turnId: "turn-history-guard",
			text: "Canonical answer",
			status: null,
		});
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [
				historyMessage("guarded-compaction", {
					turnId: "turn-history-guard",
					text: "Compacted context",
					status: null,
					displayKind: null,
					compactionSummaryType: "standalone",
				}),
				historyMessage("guarded-tool", {
					turnId: "turn-history-guard",
					text: "Tool output",
					status: null,
					toolName: "terminal",
				}),
			],
		});
		await service.history(connectionId, "stored-1", "work");
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(1);

		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [
				visibleTerminal,
				historyMessage("guarded-streaming", {
					turnId: "turn-history-guard",
					text: "Still streaming",
					status: "streaming",
				}),
			],
		});
		await service.history(connectionId, "stored-1", "work");
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(1);

		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [visibleTerminal],
		});
		await service.history(connectionId, "stored-1", "work");
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"unconflicted statusless terminal did not drain"
		);
	});

	test("requires matching turn identity for history terminals and preserves identical-text turns", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-identical-turns", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-same-a" },
			{ status: "streaming", turn_id: "turn-same-b" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Same", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Same", [], "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-identical-turns",
			turnId: "turn-same-a",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "accepted",
			"second identical turn was not accepted"
		);
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [
				historyMessage("same-user-a", { role: "user", turnId: "turn-same-a", text: "Same" }),
				historyMessage("same-assistant-a", { turnId: "turn-same-a", text: "Same" }),
				historyMessage("same-assistant-missing", { turnId: null, text: "Same" }),
				historyMessage("same-assistant-mismatch", { turnId: "turn-other", text: "Same" }),
			],
		});

		await service.history(connectionId, "stored-1", "work");
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ text: "Same", status: "accepted" }),
		]);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);

		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [
				historyMessage("same-user-a", { role: "user", turnId: "turn-same-a", text: "Same" }),
				historyMessage("same-assistant-a", { turnId: "turn-same-a", text: "Same" }),
				historyMessage("same-user-b", { role: "user", turnId: "turn-same-b", text: "Same" }),
				historyMessage("same-assistant-b", { turnId: "turn-same-b", text: "Same" }),
			],
		});
		await service.history(connectionId, "stored-1", "work");
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([]);
	});

	test("does not let null or delayed terminal identities settle a newer generation or double-drain", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-terminal-guard", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-first" },
			{ status: "streaming", turn_id: "turn-second" },
			{ status: "streaming", turn_id: "turn-third" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "First", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Second", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Third", [], "work");

		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-terminal-guard",
			turnId: "turn-first",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"second follow-up did not begin"
		);

		client.emit({ type: "message.complete", runtimeSessionId: "runtime-terminal-guard" });
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-terminal-guard",
			turnId: "turn-first",
		});
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);

		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-terminal-guard",
			turnId: "turn-second",
		});
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 3,
			"third follow-up did not begin"
		);
	});

	test("retains an uncertain follow-up when reconnect activity belongs to another client turn", async () => {
		const uncertain = new Deferred<unknown>();
		client.responses.set("session.resume", [
			{ session_id: "runtime-identity-1", session_key: "stored-1", profile: "work" },
			{
				session_id: "runtime-identity-2",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
				current_turn_id: "turn-other-client",
				messages: [
					{ id: "other-user", turn_id: "turn-other-client", role: "user", content: "Other client" },
				],
			},
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			uncertain.promise,
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Uncertain A", [], "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-identity-1",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "submitting",
			"uncertain follow-up did not begin"
		);

		service.disconnect(connectionId);
		await service.connect(connectionId);
		await Bun.sleep(5);

		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({
				text: "Uncertain A",
				status: "failed",
				error: expect.stringContaining("confirm"),
			}),
		]);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
		uncertain.resolve({ status: "streaming", turn_id: "turn-uncertain" });
	});

	test("blocks replay when the real runtime socket closes after prompt delivery becomes uncertain", async () => {
		const sockets: ServiceRuntimeSocket[] = [];
		let promptCount = 0;
		const realClient = new HermesRuntimeClient({
			socketFactory: () => {
				const socket = new ServiceRuntimeSocket((current, request) => {
					if (request.method === "session.resume") {
						queueMicrotask(() =>
							current.message({
								jsonrpc: "2.0",
								id: request.id,
								result: {
									session_id: `runtime-transport-${sockets.indexOf(current) + 1}`,
									session_key: "stored-1",
									profile: "work",
									running: false,
									status: "idle",
								},
							})
						);
						return;
					}
					if (request.method !== "prompt.submit") return;
					promptCount++;
					if (promptCount === 2) {
						queueMicrotask(() => current.close());
						return;
					}
					queueMicrotask(() =>
						current.message({
							jsonrpc: "2.0",
							id: request.id,
							result: {
								status: "streaming",
								turn_id: promptCount === 1 ? "turn-current" : "turn-duplicate",
							},
						})
					);
				});
				sockets.push(socket);
				queueMicrotask(() => socket.open());
				return socket;
			},
			reconnectBaseMs: 1,
			reconnectMaxMs: 1,
		});
		const realService = new HermesRuntimeService({
			attachmentStore: attachments,
			clientFactory: () => realClient,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => defaultManagerId,
		});
		try {
			await realService.connect(connectionId);
			await realService.resume(connectionId, "stored-1", "work");
			await realService.submit(connectionId, "stored-1", "Current", [], "work");
			await realService.submitFollowUp(connectionId, "stored-1", "Uncertain", [], "work");
			sockets[0]?.message({
				jsonrpc: "2.0",
				method: "event",
				params: {
					type: "turn.completed",
					session_id: "runtime-transport-1",
					payload: { turn_id: "turn-current" },
				},
			});

			await waitFor(() => promptCount === 2, "uncertain prompt was not put on the socket");
			await waitFor(
				() => realService.followUps(connectionId, "stored-1", "work")[0]?.status === "failed",
				"socket-close delivery was not retained for reconciliation"
			);
			const [failed] = realService.followUps(connectionId, "stored-1", "work");
			await expect(
				realService.retryFollowUp(connectionId, "stored-1", failed?.id ?? "", "work")
			).rejects.toThrow("Reconnect");
			expect(() =>
				realService.cancelFollowUp(connectionId, "stored-1", failed?.id ?? "", "work")
			).toThrow("confirm");
			await expect(
				realService.submitFollowUp(connectionId, "stored-1", "Uncertain", [], "work")
			).rejects.toThrow("Reconnect");
			expect(promptCount).toBe(2);
		} finally {
			realService.shutdown();
		}
	});

	test("retries safely when the real runtime socket closes before prompt submission", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.imagePath]);
		const sockets: ServiceRuntimeSocket[] = [];
		let attachmentCount = 0;
		let promptCount = 0;
		const realClient = new HermesRuntimeClient({
			socketFactory: () => {
				const socket = new ServiceRuntimeSocket((current, request) => {
					if (request.method === "session.resume") {
						queueMicrotask(() =>
							current.message({
								jsonrpc: "2.0",
								id: request.id,
								result: {
									session_id: `runtime-attachment-${sockets.indexOf(current) + 1}`,
									session_key: "stored-1",
									profile: "work",
									running: false,
									status: "idle",
								},
							})
						);
						return;
					}
					if (request.method === "image.attach") {
						attachmentCount++;
						if (attachmentCount === 1) {
							queueMicrotask(() => current.close());
							return;
						}
						queueMicrotask(() =>
							current.message({
								jsonrpc: "2.0",
								id: request.id,
								result: { attached: true, path: "screen.png" },
							})
						);
						return;
					}
					if (request.method !== "prompt.submit") return;
					promptCount++;
					queueMicrotask(() =>
						current.message({
							jsonrpc: "2.0",
							id: request.id,
							result: {
								status: "streaming",
								turn_id: promptCount === 1 ? "turn-current" : "turn-retried",
							},
						})
					);
				});
				sockets.push(socket);
				queueMicrotask(() => socket.open());
				return socket;
			},
			reconnectBaseMs: 1,
			reconnectMaxMs: 1,
		});
		const realService = new HermesRuntimeService({
			attachmentStore: attachments,
			clientFactory: () => realClient,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => defaultManagerId,
		});
		try {
			await realService.connect(connectionId);
			await realService.resume(connectionId, "stored-1", "work");
			await realService.submit(connectionId, "stored-1", "Current", [], "work");
			const queued = await realService.submitFollowUp(
				connectionId,
				"stored-1",
				"Retry after attachment transport",
				[selected?.handle ?? ""],
				"work"
			);
			sockets[0]?.message({
				jsonrpc: "2.0",
				method: "event",
				params: {
					type: "turn.completed",
					session_id: "runtime-attachment-1",
					payload: { turn_id: "turn-current" },
				},
			});
			await waitFor(
				() => realService.followUps(connectionId, "stored-1", "work")[0]?.status === "failed",
				"attachment transport failure was not retained"
			);
			const [failed] = realService.followUps(connectionId, "stored-1", "work");
			expect(failed?.error).toContain("Could not attach");
			expect(failed?.error).not.toContain("confirm");
			await waitFor(() => sockets.length >= 2, "runtime client did not reconnect");
			await expect(
				realService.retryFollowUp(connectionId, "stored-1", queued.followUp.id, "work")
			).resolves.toMatchObject({ ok: true });
			expect(attachmentCount).toBe(2);
			expect(promptCount).toBe(2);
		} finally {
			realService.shutdown();
		}
	});

	test("reconciles an uncertain completed follow-up from authoritative transcript identity", async () => {
		const uncertain = new Deferred<unknown>();
		client.responses.set("session.resume", [
			{ session_id: "runtime-transcript-1", session_key: "stored-1", profile: "work" },
			{
				session_id: "runtime-transcript-2",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
				messages: [
					{
						id: "canonical-uncertain",
						turn_id: "turn-uncertain",
						role: "user",
						content: "Uncertain A",
					},
				],
			},
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			uncertain.promise,
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Uncertain A", [], "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-transcript-1",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "submitting",
			"uncertain follow-up did not begin"
		);

		service.disconnect(connectionId);
		await service.connect(connectionId);
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "accepted",
			"authoritative transcript did not reconcile delivery"
		);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
		uncertain.resolve({ status: "streaming", turn_id: "turn-uncertain" });
	});

	test("reports a pre-resume submission as queued when Hermes says the durable turn is active", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-pre-resume",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
			},
		]);
		await service.connect(connectionId);

		const result = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Queue after authoritative resume",
			[],
			"work"
		);

		expect(result.disposition).toBe("queued");
		expect(result.followUp.status).toBe("queued");
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toEqual([]);
	});

	test("does not duplicate a transport-uncertain submission after reconnect", async () => {
		const uncertain = new Deferred<unknown>();
		client.responses.set("session.resume", [
			{ session_id: "runtime-uncertain-1", session_key: "stored-1", profile: "work" },
			{
				session_id: "runtime-uncertain-2",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
			},
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			uncertain.promise,
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Uncertain", [], "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-uncertain-1",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "submitting",
			"queued follow-up did not begin submitting"
		);

		service.disconnect(connectionId);
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ status: "failed", error: expect.stringContaining("confirming") }),
		]);
		const [failed] = service.followUps(connectionId, "stored-1", "work");
		await expect(
			service.retryFollowUp(connectionId, "stored-1", failed?.id ?? "", "work")
		).rejects.toThrow("Reconnect");
		await expect(
			service.submitFollowUp(connectionId, "stored-1", "Uncertain", [], "work")
		).rejects.toThrow("Reconnect");
		await service.connect(connectionId);
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);

		uncertain.resolve({ status: "streaming" });
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
	});

	test("reconciles a transport-uncertain submission when reconnect confirms it is active", async () => {
		const uncertain = new Deferred<unknown>();
		client.responses.set("session.resume", [
			{ session_id: "runtime-confirmed-1", session_key: "stored-1", profile: "work" },
			{
				session_id: "runtime-confirmed-2",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
				current_turn_id: "turn-uncertain",
				messages: [
					{ id: "uncertain-user", turn_id: "turn-uncertain", role: "user", content: "Uncertain" },
				],
			},
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			uncertain.promise,
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Uncertain", [], "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-confirmed-1",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "submitting",
			"queued follow-up did not begin submitting"
		);

		service.disconnect(connectionId);
		await service.connect(connectionId);
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "accepted",
			"reconnect did not reconcile the uncertain follow-up"
		);

		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ text: "Uncertain", status: "accepted" }),
		]);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
		uncertain.resolve({ status: "streaming" });
		await Bun.sleep(5);
		expect(client.requests.filter((request) => request.method === "prompt.submit")).toHaveLength(2);
	});

	test("drains the next follow-up when terminal completion beats prompt acknowledgement", async () => {
		const acknowledgement = new Deferred<unknown>();
		client.responses.set("session.resume", [
			{ session_id: "runtime-fast-terminal", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			acknowledgement.promise,
			{ status: "streaming", turn_id: "turn-next" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Fast", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Next", [], "work");

		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-fast-terminal",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "submitting",
			"first queued follow-up did not begin submitting"
		);
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-fast-terminal",
			turnId: "turn-fast",
		});
		acknowledgement.resolve({ status: "complete", turn_id: "turn-fast" });

		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 3,
			"next follow-up did not drain after the early terminal event"
		);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params["text"])
		).toEqual(["Current", "Fast", "Next"]);
	});

	test("isolates follow-up queues by connection profile and durable session composite", async () => {
		admitAgentSession("same-session", "work");
		admitAgentSession("same-session", "personal");
		rest.sessions = [
			{ ...session("same-session"), profileId: "work", source: "superiorswarm", origin: null },
			{
				...session("same-session"),
				profileId: "personal",
				source: "superiorswarm",
				origin: null,
			},
		];
		client.responses.set("session.resume", [
			{ session_id: "runtime-work", session_key: "same-session", profile: "work" },
			{ session_id: "runtime-personal", session_key: "same-session", profile: "personal" },
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }, { status: "streaming" }]);
		await service.connect(connectionId);
		await service.resume(connectionId, "same-session", "work");
		await service.submit(connectionId, "same-session", "Work current", [], "work");
		await service.submitFollowUp(connectionId, "same-session", "Work queued", [], "work");
		await service.submitFollowUp(connectionId, "same-session", "Personal direct", [], "personal");

		expect(service.followUps(connectionId, "same-session", "work")).toEqual([
			expect.objectContaining({ text: "Work queued", profileId: "work" }),
		]);
		expect(service.followUps(connectionId, "same-session", "personal")).toEqual([]);
		expect(
			client.requests
				.filter((request) => request.method === "prompt.submit")
				.map((request) => request.params)
		).toEqual([
			expect.objectContaining({ session_id: "runtime-work", text: "Work current" }),
			expect.objectContaining({ session_id: "runtime-personal", text: "Personal direct" }),
		]);
	});

	test("projects profile identity and isolates artifact links when durable session IDs collide", async () => {
		const now = new Date();
		for (const profileId of ["work", "personal"] as const) {
			getDb()
				.insert(schema.projects)
				.values({
					id: `project-${profileId}-event`,
					name: `${profileId} event project`,
					repoPath: `/repos/${profileId}-event`,
					defaultBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			getDb()
				.insert(schema.worktrees)
				.values({
					id: `worktree-${profileId}-event`,
					projectId: `project-${profileId}-event`,
					path: `/repos/${profileId}-event-worktrees/feat/${profileId}`,
					branch: `feat/${profileId}`,
					baseBranch: "main",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			getDb()
				.insert(schema.workspaces)
				.values({
					id: `workspace-${profileId}-event`,
					projectId: `project-${profileId}-event`,
					type: "worktree",
					name: `${profileId} event workspace`,
					worktreeId: `worktree-${profileId}-event`,
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}
		admitAgentSession("same-session", "work");
		admitAgentSession("same-session", "personal");
		rest.sessions = [
			{ ...session("same-session"), profileId: "work", source: "superiorswarm", origin: null },
			{
				...session("same-session"),
				profileId: "personal",
				source: "superiorswarm",
				origin: null,
			},
		];
		client.responses.set("session.resume", [
			{ session_id: "runtime-work-event", session_key: "same-session", profile: "work" },
			{
				session_id: "runtime-personal-event",
				session_key: "same-session",
				profile: "personal",
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "same-session", "work");
		await service.resume(connectionId, "same-session", "personal");

		client.emit({
			type: "message.delta",
			runtimeSessionId: "runtime-work-event",
			turnId: "turn-work",
			text: "work secret",
		});
		client.emit({
			type: "message.delta",
			runtimeSessionId: "runtime-personal-event",
			turnId: "turn-personal",
			text: "personal secret",
		});
		for (const profileId of ["work", "personal"] as const) {
			client.emit({
				type: "tool.result",
				runtimeSessionId: `runtime-${profileId}-event`,
				workspaceArtifacts: [
					{
						kind: "superiorswarm.workspace.created",
						workspaceId: `workspace-${profileId}-event`,
						projectId: `project-${profileId}-event`,
						branch: `feat/${profileId}`,
						worktreePath: `/repos/${profileId}-event-worktrees/feat/${profileId}`,
					},
				],
			});
		}

		const deltas = service
			.events(connectionId, 0)
			.events.filter((entry) => entry.event.type === "message.delta")
			.map((entry) => entry.event);
		expect(deltas).toEqual([
			expect.objectContaining({
				profileId: "work",
				durableSessionId: "same-session",
				text: "work secret",
			}),
			expect.objectContaining({
				profileId: "personal",
				durableSessionId: "same-session",
				text: "personal secret",
			}),
		]);
		const workLinks = listHermesWorkspaceLinks(connectionId, "work", "same-session");
		const personalLinks = listHermesWorkspaceLinks(connectionId, "personal", "same-session");
		expect(workLinks).toEqual([
			expect.objectContaining({
				profileId: "work",
				workspaceId: "workspace-work-event",
				branch: "feat/work",
			}),
		]);
		expect(personalLinks).toEqual([
			expect.objectContaining({
				profileId: "personal",
				workspaceId: "workspace-personal-event",
				branch: "feat/personal",
			}),
		]);
		expect(JSON.stringify(workLinks)).not.toContain("workspace-personal-event");
		expect(JSON.stringify(personalLinks)).not.toContain("workspace-work-event");
	});

	test("cancels a queued follow-up and releases its claimed attachment handle", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.filePath]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-cancel", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		const queued = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Cancel me",
			[selected?.handle ?? ""],
			"work"
		);

		attachments.release([selected?.handle ?? ""]);
		expect(attachments.size).toBe(1);
		expect(service.cancelFollowUp(connectionId, "stored-1", queued.followUp.id, "work")).toEqual({
			ok: true,
		});
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([]);
		expect(attachments.size).toBe(0);
	});

	test("cancels queue admission across attachment claim when the connection is forgotten", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.filePath]);
		const claimGate = new Deferred<void>();
		let claimStarted = false;
		const originalClaim = attachments.claim.bind(attachments);
		attachments.claim = async (handles, ownerId) => {
			claimStarted = true;
			await claimGate.promise;
			return await originalClaim(handles, ownerId);
		};
		await service.connect(connectionId);

		const admission = service.submitFollowUp(
			connectionId,
			"stored-1",
			"Must be cancelled",
			[selected?.handle ?? ""],
			"work"
		);
		await waitFor(() => claimStarted, "attachment claim did not start");
		service.forgetConnection(connectionId);
		claimGate.resolve();

		await expect(admission).rejects.toThrow("cancelled");
		expect(attachments.size).toBe(0);
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([]);
	});

	test("projects queued follow-ups through resume and preserves them across disconnect/reconnect", async () => {
		client.responses.set("session.resume", [
			{ session_id: "runtime-before", session_key: "stored-1", profile: "work" },
			{
				session_id: "runtime-after",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "idle",
			},
		]);
		client.responses.set("session.activate", [
			{
				session_id: "runtime-before",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
			},
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }, { status: "streaming" }]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Survive reload", [], "work");

		const reloadSnapshot = await service.resume(connectionId, "stored-1", "work");
		expect(reloadSnapshot.activeTurnSnapshot.queuedFollowUps).toEqual([
			expect.objectContaining({ text: "Survive reload", status: "queued", attachments: [] }),
		]);
		service.disconnect(connectionId);
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ text: "Survive reload", status: "queued" }),
		]);
		expect(service.getState(connectionId).queuedFollowUps).toEqual([
			{
				durableSessionId: "stored-1",
				profileId: "work",
				queuedCount: 1,
				failedCount: 0,
			},
		]);

		await service.connect(connectionId);
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 2,
			"queued follow-up did not resume after reconnect"
		);
		expect(
			client.requests.filter((request) => request.method === "prompt.submit").at(-1)?.params["text"]
		).toBe("Survive reload");
	});

	test("retains accepted projections beyond five minutes until canonical history reconciles them", async () => {
		let clock = 1_000;
		service.shutdown();
		service = new HermesRuntimeService({
			attachmentStore: attachments,
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
			loopbackTokenResolver: async () => "secret",
			externalManagerIdResolver: () => defaultManagerId,
			now: () => clock,
		});
		client.responses.set("session.resume", [
			{ session_id: "runtime-stable-ledger", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			{ status: "streaming", turn_id: "turn-accepted" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		await service.submitFollowUp(connectionId, "stored-1", "Accepted follow-up", [], "work");
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-stable-ledger",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "accepted",
			"queued follow-up was not accepted"
		);
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-stable-ledger",
			turnId: "turn-accepted",
		});
		clock += 5 * 60 * 1_000 + 1;

		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ text: "Accepted follow-up", status: "accepted" }),
		]);

		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [
				historyMessage("canonical-accepted", {
					role: "user",
					turnId: "turn-accepted",
					text: "Accepted follow-up",
				}),
			],
		});
		await service.history(connectionId, "stored-1", "work");
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([]);
	});

	test("keeps failed queued attachments retryable without duplicate upload and releases on success", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.imagePath]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-queue-retry", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("image.attach", [{ attached: true }]);
		client.responses.set("prompt.submit", [
			{ status: "streaming", turn_id: "turn-current" },
			new Error("queued send failed"),
			{ status: "streaming", turn_id: "turn-retry" },
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1", "work");
		await service.submit(connectionId, "stored-1", "Current", [], "work");
		const queued = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Retry attachment",
			[selected?.handle ?? ""],
			"work"
		);

		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-queue-retry",
			turnId: "turn-current",
		});
		await waitFor(
			() => service.followUps(connectionId, "stored-1", "work")[0]?.status === "failed",
			"queued failure was not retained"
		);
		expect(attachments.size).toBe(1);

		await service.retryFollowUp(connectionId, "stored-1", queued.followUp.id, "work");
		await waitFor(
			() => client.requests.filter((request) => request.method === "prompt.submit").length === 3,
			"failed follow-up did not retry"
		);
		expect(client.requests.filter((request) => request.method === "image.attach")).toHaveLength(1);
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

	test("rejects unsafe stock file references without leaking selected, staged, or backend paths", async () => {
		const fixture = await attachmentFixture();
		const [selected] = await attachments.registerPaths([fixture.filePath]);
		const stagedPath = (await attachments.resolve([selected?.handle ?? ""]))[0]?.path ?? "";
		client.responses.set("session.resume", [
			{ session_id: "runtime-malicious-ref", session_key: "stored-1", profile: "work" },
		]);
		const maliciousReferences = [
			"@file:/etc/passwd",
			"@file:../private/notes.txt",
			"@file:attachments/../../private/notes.txt",
			"@file:file:///private/notes.txt",
			"@file:C:/private/notes.txt",
			"@file:attachments/notes.txt\n/private/backend",
		];
		client.responses.set("file.attach", [
			...maliciousReferences.map((ref_text) => ({ attached: true, ref_text })),
			new Error(
				`failed selected=${fixture.filePath} staged=${stagedPath} backend=/var/lib/hermes/private.txt`
			),
		]);
		await service.connect(connectionId);

		for (const maliciousReference of maliciousReferences) {
			const error = await service
				.submit(connectionId, "stored-1", "Inspect", [selected?.handle ?? ""])
				.catch((reason: unknown) => reason);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).not.toContain(maliciousReference);
			expect((error as Error).message).not.toContain(fixture.directory);
			expect((error as Error).message).not.toContain(stagedPath);
		}

		const backendError = await service
			.submit(connectionId, "stored-1", "Inspect", [selected?.handle ?? ""])
			.catch((reason: unknown) => reason);
		expect(backendError).toBeInstanceOf(Error);
		expect((backendError as Error).message).toBe(
			"Could not attach “notes.txt”: Hermes rejected the attachment"
		);
		expect((backendError as Error).message).not.toContain(fixture.filePath);
		expect((backendError as Error).message).not.toContain(stagedPath);
		expect((backendError as Error).message).not.toContain("/var/lib/hermes");
	});

	test("never copies image or PDF backend references into transcript attachment metadata", async () => {
		const fixture = await attachmentFixture();
		const selected = await attachments.registerPaths([fixture.imagePath, fixture.pdfPath]);
		client.responses.set("session.resume", [
			{ session_id: "runtime-media-ref", session_key: "stored-1", profile: "work" },
		]);
		client.responses.set("image.attach", [
			{ attached: true, ref_text: "@file:../../backend/private-image.png" },
		]);
		client.responses.set("pdf.attach", [
			{ attached: true, ref_text: "/var/lib/hermes/private-plan.pdf" },
		]);
		await service.connect(connectionId);

		await service.submit(
			connectionId,
			"stored-1",
			"Inspect media",
			selected.map((item) => item.handle)
		);

		const prompt = String(
			client.requests.find((request) => request.method === "prompt.submit")?.params["text"]
		);
		expect(prompt).toContain("screen.png");
		expect(prompt).toContain("plan.pdf");
		expect(prompt).not.toContain("../../backend");
		expect(prompt).not.toContain("/var/lib/hermes");
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
			omit_messages: false,
		});
	});

	test("returns a complete active-turn snapshot without replacing canonical durable history", async () => {
		const durableMessage = historyMessage("durable-before-active-turn", {
			text: "Canonical completed answer",
		});
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [durableMessage],
		});
		client.responses.set("session.resume", [
			{
				session_id: "runtime-active",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "streaming",
				messages: [
					{ id: "active-user", turn_id: "turn-live", role: "user", content: "Investigate" },
					{
						id: "active-tool",
						turn_id: "turn-live",
						role: "tool",
						name: "terminal",
						status: "complete",
						content: "done",
					},
					{
						id: "active-answer",
						turn_id: "turn-live",
						role: "assistant",
						status: "streaming",
						content: "Complete answer accumulated before this late join",
					},
				],
			},
		]);
		await service.connect(connectionId);

		const resumed = await service.resume(connectionId, "stored-1");

		expect(client.requests[0]?.params["omit_messages"]).toBe(false);
		expect(resumed.activeTurnSnapshot).toMatchObject({
			durableSessionId: "stored-1",
			runtimeSessionId: "runtime-active",
			activeTurn: true,
			status: "streaming",
			turnId: "turn-live",
			streamingText: "Complete answer accumulated before this late join",
			tools: [{ id: "active-tool", name: "terminal", status: "complete" }],
		});
		expect(resumed.history).toEqual({
			durableSessionId: "stored-1",
			view: "durable",
			messages: [durableMessage],
		});
	});

	test("late join uses a fresh snapshot instead of depending on the bounded delta buffer", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-buffered",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "streaming",
				messages: [],
			},
		]);
		client.responses.set("session.activate", [
			{
				session_id: "runtime-buffered",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "streaming",
				messages: [
					{ id: "active-user", turn_id: "turn-buffered", role: "user", content: "Work" },
					{
						id: "active-answer",
						turn_id: "turn-buffered",
						role: "assistant",
						status: "streaming",
						content: "Authoritative complete answer after more than one thousand deltas",
					},
				],
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		for (let index = 0; index < 1_100; index++) {
			client.emit({
				type: "message.delta",
				runtimeSessionId: "runtime-buffered",
				text: "x",
			});
		}

		const rejoined = await service.resume(connectionId, "stored-1");

		expect(service.events(connectionId, 0).events).toHaveLength(1_000);
		expect(rejoined.activeTurnSnapshot).toMatchObject({
			eventSeq: 1_100,
			activeTurn: true,
			streamingText: "Authoritative complete answer after more than one thousand deltas",
		});
		expect(client.requests.at(-1)).toEqual({
			method: "session.activate",
			params: { session_id: "runtime-buffered", omit_messages: false },
		});
	});

	test("late selection recovers native subagents from the main-owned conversation snapshot", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-subagents",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "streaming",
				messages: [],
			},
		]);
		client.responses.set("session.activate", [
			{
				session_id: "runtime-subagents",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "streaming",
				messages: [],
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		client.emit({
			type: "subagent.progress",
			runtimeSessionId: "runtime-subagents",
			text: "Inspecting the gateway",
			toolName: "search",
			payload: {
				subagent: {
					subagentId: "native-child",
					parentId: null,
					childSessionId: "child-session",
					goal: "Find the queue race",
					model: "hermes-test",
					status: "running",
					taskIndex: 0,
					taskCount: 1,
					depth: 1,
					toolCount: 1,
					durationSeconds: null,
					costUsd: null,
					inputTokens: null,
					outputTokens: null,
					summary: null,
					filesRead: [],
					filesWritten: [],
				},
			},
			receivedAt: 50,
		});

		const rejoined = await service.resume(connectionId, "stored-1");
		expect(rejoined.activeTurnSnapshot.subagents).toEqual([
			expect.objectContaining({
				subagentId: "native-child",
				goal: "Find the queue race",
				latestText: "Inspecting the gateway",
				currentTool: "search",
			}),
		]);
	});

	test("snapshots only unresolved interactions for their owning session", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
			},
			{
				session_id: "runtime-2",
				session_key: "stored-2",
				profile: "work",
				running: true,
				status: "working",
			},
		]);
		client.responses.set("session.activate", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				running: true,
				status: "working",
			},
			{
				session_id: "runtime-2",
				session_key: "stored-2",
				profile: "work",
				running: true,
				status: "working",
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		await service.resume(connectionId, "stored-2");

		client.emit({
			type: "approval.request",
			runtimeSessionId: "runtime-1",
			requestId: "approval-1",
			text: "Allow deployment?",
			payload: { choices: [{ value: "once", label: "Allow once" }] },
		});
		client.emit({
			type: "clarify.request",
			runtimeSessionId: "runtime-2",
			requestId: "clarify-2",
			text: "Which environment?",
			payload: { choices: [{ value: "staging", label: "Staging" }] },
		});

		const first = await service.resume(connectionId, "stored-1");
		const second = await service.resume(connectionId, "stored-2");
		expect(first.activeTurnSnapshot).toMatchObject({
			pendingApproval: {
				requestId: "approval-1",
				prompt: "Allow deployment?",
				choices: [{ value: "once", label: "Allow once" }],
			},
			pendingClarification: null,
		});
		expect(second.activeTurnSnapshot).toMatchObject({
			pendingApproval: null,
			pendingClarification: {
				requestId: "clarify-2",
				prompt: "Which environment?",
				choices: [{ value: "staging", label: "Staging" }],
			},
		});

		await service.respondToApproval({
			connectionId,
			hermesSessionId: "stored-1",
			requestId: "approval-1",
			choice: "once",
		});
		client.emit({
			type: "clarify.expire",
			runtimeSessionId: "runtime-2",
			requestId: "clarify-2",
		});
		client.emit({
			type: "turn.completed",
			runtimeSessionId: "runtime-1",
			status: "complete",
		});

		client.responses.set("session.activate", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				running: false,
				status: "complete",
			},
			{
				session_id: "runtime-2",
				session_key: "stored-2",
				profile: "work",
				running: true,
				status: "working",
			},
		]);
		expect((await service.resume(connectionId, "stored-1")).activeTurnSnapshot).toMatchObject({
			pendingApproval: null,
			pendingClarification: null,
		});
		expect((await service.resume(connectionId, "stored-2")).activeTurnSnapshot).toMatchObject({
			pendingApproval: null,
			pendingClarification: null,
		});
	});

	test("keeps durable physical history authoritative across resume and reconnect refresh", async () => {
		const durableMessages: HermesSessionHistory["messages"] = [
			{
				id: "archived-original",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 0,
				active: false,
				compacted: true,
				displayKind: null,
				compactionSummaryType: null,
				turnId: "turn-old",
				role: "user",
				text: "Archived question",
				createdAt: 1,
				status: "complete",
				toolName: null,
				workspaceArtifacts: [],
			},
			{
				id: "summary-one",
				canonicalMessageId: "canonical-summary",
				compactionGeneration: 1,
				active: true,
				compacted: false,
				displayKind: "compaction_summary",
				compactionSummaryType: "standalone",
				turnId: null,
				role: "assistant",
				text: "Durable summary",
				createdAt: 2,
				status: "complete",
				toolName: null,
				workspaceArtifacts: [],
			},
		];
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: durableMessages,
		});
		client.responses.set("session.resume", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				messages: [{ id: "active-summary-only", role: "assistant", content: "Active context" }],
			},
			{
				session_id: "runtime-2",
				session_key: "stored-1",
				profile: "work",
				messages: [{ id: "active-summary-only", role: "assistant", content: "Active context" }],
			},
		]);
		await service.connect(connectionId);

		const resumed = await service.resume(connectionId, "stored-1");
		expect(resumed.history.view).toBe("durable");
		expect(resumed.history.messages.map((message) => message.id)).toEqual([
			"archived-original",
			"summary-one",
		]);
		expect(client.requests[0]?.params["omit_messages"]).toBe(false);

		client.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await waitFor(() => rest.transcriptCalls.length >= 2, "durable history was not refreshed");
		const feed = service.events(connectionId, 0);
		expect(JSON.stringify(feed)).not.toContain("active-summary-only");
		expect((await service.history(connectionId, "stored-1")).messages).toEqual(durableMessages);
	});

	test("retains cached durable archives when resume and reconnect refresh fall back to active", async () => {
		const archived = historyMessage("archived-original", {
			active: false,
			compacted: true,
			text: "Archived original",
		});
		const activeCopy = historyMessage("active-copy", {
			canonicalMessageId: "archived-original",
			text: "Active retained copy",
		});
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "durable",
			messages: [archived, activeCopy],
		});
		client.responses.set("session.resume", [
			{ session_id: "runtime-1", session_key: "stored-1", profile: "work" },
			{ session_id: "runtime-2", session_key: "stored-1", profile: "work" },
		]);
		await service.connect(connectionId);

		const resumed = await service.resume(connectionId, "stored-1");
		expect(resumed.history.view).toBe("durable");

		const newActiveTail = historyMessage("new-active-tail", {
			canonicalMessageId: null,
			text: "New active tail",
		});
		rest.histories.set("stored-1", {
			durableSessionId: "stored-1",
			view: "active",
			messages: [activeCopy, newActiveTail],
		});
		client.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await waitFor(() => rest.transcriptCalls.length >= 2, "active fallback was not refreshed");

		const reconciled = await service.history(connectionId, "stored-1");
		expect(reconciled.view).toBe("durable");
		expect(reconciled.messages.map((item) => item.id)).toEqual([
			"archived-original",
			"active-copy",
			"new-active-tail",
		]);
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
				profileId: "work",
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
				messages: [
					{ id: "reconnect-user", turn_id: "turn-reconnect", role: "user", content: "Continue" },
					{
						id: "reconnect-answer",
						turn_id: "turn-reconnect",
						role: "assistant",
						status: "streaming",
						content: "Complete answer restored on reconnect",
					},
				],
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");

		client.emit({ type: "runtime.history-refresh-required", status: "reconnected" });
		await Bun.sleep(5);

		const queued = await service.submitFollowUp(
			connectionId,
			"stored-1",
			"Queued after reconnect",
			[],
			"work"
		);
		expect(queued.disposition).toBe("queued");
		expect(service.followUps(connectionId, "stored-1", "work")).toEqual([
			expect.objectContaining({ text: "Queued after reconnect", status: "queued" }),
		]);
		const reconciled = service
			.events(connectionId, 0)
			.events.find((entry) => entry.event.type === "runtime.history-refresh-required");
		expect(reconciled?.event.payload.bindings?.[0]).toMatchObject({
			activeTurn: true,
			status: "working",
		});
		const snapshot = service
			.events(connectionId, 0)
			.events.find((entry) => entry.event.type === "runtime.active-turn-snapshot");
		expect(snapshot?.event.payload.activeTurnSnapshot).toMatchObject({
			activeTurn: true,
			streamingText: "Complete answer restored on reconnect",
		});
	});

	test("maps live events to durable IDs and refreshes REST after terminal completion", async () => {
		client.responses.set("session.resume", [
			{
				session_id: "runtime-1",
				session_key: "stored-1",
				profile: "work",
				running: true,
				current_turn_id: "turn-1",
			},
		]);
		await service.connect(connectionId);
		await service.resume(connectionId, "stored-1");
		const callsBeforeCompletion = rest.transcriptCalls.length;

		client.emit({
			type: "message.complete",
			runtimeSessionId: "runtime-1",
			turnId: "turn-1",
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
			view: "durable",
			messages: [
				{
					id: "assistant-1",
					canonicalMessageId: "assistant-1",
					compactionGeneration: 0,
					active: true,
					compacted: false,
					displayKind: null,
					compactionSummaryType: null,
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

		const canonicalMessages = rest.histories.get("stored-1")?.messages ?? [];
		rest.details.set("compression-child", {
			...(rest.details.get("stored-1") as HermesStockSessionDetail),
			durableSessionId: "compression-child",
		});
		rest.histories.set(
			"stored-1",
			compressedHistory("stored-1", "compression-child", canonicalMessages)
		);
		rest.histories.set("compression-child", {
			durableSessionId: "compression-child",
			view: "durable",
			messages: canonicalMessages,
		});
		await service.history(connectionId, "stored-1", "work");

		const compressedDuplicate = await service.reportToOrigin({
			connectionId,
			hermesSessionId: "compression-child",
			profileId: "work",
			messageId: "assistant-1",
			explicitRetry: false,
		});
		expect(compressedDuplicate.status).toBe("duplicate-suppressed");
		expect(sender.sends).toHaveLength(1);
	});

	test("finishes an in-flight origin report on the physical compression child", async () => {
		const sendGate = new Deferred<{ providerMessageId: string | null }>();
		sender.response = sendGate.promise;
		const detail: HermesStockSessionDetail = {
			durableSessionId: "report-parent",
			profileId: "work",
			source: "slack",
			displayName: "Support thread",
			sessionKey: null,
			chatId: "C12345",
			chatType: "channel",
			threadId: "1234567890.123456",
			originJson: { platform: "slack", scope_id: "T12345" },
		};
		const messages = [
			historyMessage("assistant-in-flight", {
				turnId: "turn-report",
				text: "One canonical update",
			}),
		];
		rest.details.set("report-parent", detail);
		rest.histories.set("report-parent", {
			durableSessionId: "report-parent",
			view: "durable",
			messages,
		});
		await service.connect(connectionId);

		const reporting = service.reportToOrigin({
			connectionId,
			hermesSessionId: "report-parent",
			profileId: "work",
			messageId: "assistant-in-flight",
			explicitRetry: false,
		});
		await waitFor(() => sender.sends.length === 1, "origin send did not begin");
		rest.details.set("report-child", { ...detail, durableSessionId: "report-child" });
		rest.histories.set(
			"report-parent",
			compressedHistory("report-parent", "report-child", messages)
		);
		rest.histories.set("report-child", {
			durableSessionId: "report-child",
			view: "durable",
			messages,
		});
		await service.history(connectionId, "report-parent", "work");
		sendGate.resolve({ providerMessageId: "provider-in-flight" });

		await expect(reporting).resolves.toMatchObject({
			hermesSessionId: "report-child",
			status: "sent",
			providerMessageId: "provider-in-flight",
		});
		await expect(
			service.reportToOrigin({
				connectionId,
				hermesSessionId: "report-child",
				profileId: "work",
				messageId: "assistant-in-flight",
				explicitRetry: false,
			})
		).resolves.toMatchObject({ status: "duplicate-suppressed" });
		expect(sender.sends).toHaveLength(1);
	});

	test("does not let a migrated in-flight report downgrade an existing canonical sent receipt", async () => {
		const parentGate = new Deferred<{ providerMessageId: string | null }>();
		const detail: HermesStockSessionDetail = {
			durableSessionId: "sent-parent",
			profileId: "work",
			source: "slack",
			displayName: "Support thread",
			sessionKey: null,
			chatId: "C12345",
			chatType: "channel",
			threadId: "1234567890.123456",
			originJson: { platform: "slack", scope_id: "T12345" },
		};
		const messages = [
			historyMessage("assistant-sent-collision", {
				turnId: "turn-sent-collision",
				text: "One canonical update",
			}),
		];
		rest.details.set("sent-parent", detail);
		rest.details.set("sent-child", { ...detail, durableSessionId: "sent-child" });
		rest.histories.set("sent-parent", {
			durableSessionId: "sent-parent",
			view: "durable",
			messages,
		});
		rest.histories.set("sent-child", {
			durableSessionId: "sent-child",
			view: "durable",
			messages,
		});
		await service.connect(connectionId);

		await expect(
			service.reportToOrigin({
				connectionId,
				hermesSessionId: "sent-child",
				profileId: "work",
				messageId: "assistant-sent-collision",
				explicitRetry: false,
			})
		).resolves.toMatchObject({ status: "sent" });
		sender.response = parentGate.promise;
		const parentReporting = service.reportToOrigin({
			connectionId,
			hermesSessionId: "sent-parent",
			profileId: "work",
			messageId: "assistant-sent-collision",
			explicitRetry: false,
		});
		await waitFor(() => sender.sends.length === 2, "parent origin send did not begin");
		rest.histories.set("sent-parent", compressedHistory("sent-parent", "sent-child", messages));
		await service.history(connectionId, "sent-parent", "work");
		parentGate.reject(new Error("late parent failure"));

		await expect(parentReporting).resolves.toMatchObject({
			hermesSessionId: "sent-child",
			status: "sent",
		});
		await expect(
			service.reportToOrigin({
				connectionId,
				hermesSessionId: "sent-child",
				profileId: "work",
				messageId: "assistant-sent-collision",
				explicitRetry: true,
			})
		).resolves.toMatchObject({ status: "duplicate-suppressed" });
		expect(sender.sends).toHaveLength(2);
	});

	test("keeps a merged receipt claimed until every colliding in-flight report settles", async () => {
		const parentGate = new Deferred<{ providerMessageId: string | null }>();
		const childGate = new Deferred<{ providerMessageId: string | null }>();
		const detail: HermesStockSessionDetail = {
			durableSessionId: "dual-parent",
			profileId: "work",
			source: "slack",
			displayName: "Support thread",
			sessionKey: null,
			chatId: "C12345",
			chatType: "channel",
			threadId: "1234567890.123456",
			originJson: { platform: "slack", scope_id: "T12345" },
		};
		const messages = [
			historyMessage("assistant-dual-in-flight", {
				turnId: "turn-dual-in-flight",
				text: "One canonical update",
			}),
		];
		rest.details.set("dual-parent", detail);
		rest.details.set("dual-child", { ...detail, durableSessionId: "dual-child" });
		rest.histories.set("dual-parent", {
			durableSessionId: "dual-parent",
			view: "durable",
			messages,
		});
		rest.histories.set("dual-child", {
			durableSessionId: "dual-child",
			view: "durable",
			messages,
		});
		await service.connect(connectionId);

		sender.response = parentGate.promise;
		const parentReporting = service.reportToOrigin({
			connectionId,
			hermesSessionId: "dual-parent",
			profileId: "work",
			messageId: "assistant-dual-in-flight",
			explicitRetry: false,
		});
		await waitFor(() => sender.sends.length === 1, "parent send did not begin");
		sender.response = childGate.promise;
		const childReporting = service.reportToOrigin({
			connectionId,
			hermesSessionId: "dual-child",
			profileId: "work",
			messageId: "assistant-dual-in-flight",
			explicitRetry: false,
		});
		await waitFor(() => sender.sends.length === 2, "child send did not begin");
		rest.histories.set("dual-parent", compressedHistory("dual-parent", "dual-child", messages));
		await service.history(connectionId, "dual-parent", "work");
		parentGate.reject(new Error("first active attempt failed"));
		await parentReporting;

		const retryWhileChildActive = service.reportToOrigin({
			connectionId,
			hermesSessionId: "dual-child",
			profileId: "work",
			messageId: "assistant-dual-in-flight",
			explicitRetry: true,
		});
		await Bun.sleep(5);
		expect(sender.sends).toHaveLength(2);
		await expect(retryWhileChildActive).resolves.toMatchObject({
			status: "duplicate-suppressed",
		});
		childGate.resolve({ providerMessageId: "provider-dual-child" });
		await expect(childReporting).resolves.toMatchObject({
			status: "sent",
			providerMessageId: "provider-dual-child",
		});
	});

	test("releases migrated report attempts when a deleted connection ID is recreated", async () => {
		const sendGate = new Deferred<{ providerMessageId: string | null }>();
		sender.response = sendGate.promise;
		const detail: HermesStockSessionDetail = {
			durableSessionId: "deleted-report-parent",
			profileId: "work",
			source: "slack",
			displayName: "Support thread",
			sessionKey: null,
			chatId: "C12345",
			chatType: "channel",
			threadId: "1234567890.123456",
			originJson: { platform: "slack", scope_id: "T12345" },
		};
		const messages = [
			historyMessage("assistant-delete-in-flight", {
				turnId: "turn-delete-in-flight",
				text: "One canonical update",
			}),
		];
		rest.details.set("deleted-report-parent", detail);
		rest.details.set("deleted-report-child", {
			...detail,
			durableSessionId: "deleted-report-child",
		});
		rest.histories.set("deleted-report-parent", {
			durableSessionId: "deleted-report-parent",
			view: "durable",
			messages,
		});
		rest.histories.set("deleted-report-child", {
			durableSessionId: "deleted-report-child",
			view: "durable",
			messages,
		});
		await service.connect(connectionId);

		const reporting = service.reportToOrigin({
			connectionId,
			hermesSessionId: "deleted-report-parent",
			profileId: "work",
			messageId: "assistant-delete-in-flight",
			explicitRetry: false,
		});
		await waitFor(() => sender.sends.length === 1, "origin send did not begin before deletion");
		rest.histories.set(
			"deleted-report-parent",
			compressedHistory("deleted-report-parent", "deleted-report-child", messages)
		);
		await service.history(connectionId, "deleted-report-parent", "work");

		service.forgetConnection(connectionId);
		deleteHermesConnection(connectionId, vault);
		saveHermesConnection(
			{
				id: connectionId,
				label: "Recreated stock Hermes",
				baseUrl: "http://127.0.0.1:9119",
				profileId: "work",
				token: "secret",
			},
			vault
		);
		sender.response = null;
		await service.connect(connectionId);
		await expect(
			service.reportToOrigin({
				connectionId,
				hermesSessionId: "deleted-report-child",
				profileId: "work",
				messageId: "assistant-delete-in-flight",
				explicitRetry: false,
			})
		).resolves.toMatchObject({ status: "sent" });
		expect(sender.sends).toHaveLength(2);

		sendGate.reject(new Error("connection deleted during send"));
		await expect(reporting).rejects.toThrow("not found");
		await expect(
			service.reportToOrigin({
				connectionId,
				hermesSessionId: "deleted-report-child",
				profileId: "work",
				messageId: "assistant-delete-in-flight",
				explicitRetry: false,
			})
		).resolves.toMatchObject({ status: "duplicate-suppressed" });
		expect(sender.sends).toHaveLength(2);
	});
});
