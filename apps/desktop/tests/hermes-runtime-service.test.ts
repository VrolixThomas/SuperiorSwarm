import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _setDbForTesting } from "../src/main/db";
import { saveHermesConnection } from "../src/main/hermes/hermes-connections";
import type { HermesStockSessionDetail } from "../src/main/hermes/hermes-rest-client";
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

	connect(): Promise<void> {
		return Promise.resolve();
	}

	disconnect(): void {
		this.state.status = "disconnected";
	}

	request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.requests.push({ method, params });
		const queued = this.responses.get(method) ?? [];
		if (queued.length === 0) return Promise.resolve({ ok: true });
		const response = queued.shift();
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

class FakeRestClient implements HermesRestClientLike {
	sessions: HermesSessionSummary[] = [];
	histories = new Map<string, HermesSessionHistory>();
	details = new Map<string, HermesStockSessionDetail>();
	listCalls = 0;
	transcriptCalls: Array<{ durableSessionId: string; profileId: string }> = [];

	listSessions(): Promise<HermesSessionSummary[]> {
		this.listCalls++;
		return Promise.resolve(this.sessions);
	}

	getTranscript(durableSessionId: string, profileId: string): Promise<HermesSessionHistory> {
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
		origin: {
			platform: "slack",
			displayLabel: "Slack",
			hasThread: true,
			canOpenThread: false,
			canReport: false,
			openUrl: null,
		},
	};
}

describe("HermesRuntimeService stock lifecycle", () => {
	let client: FakeRuntimeClient;
	let rest: FakeRestClient;
	let service: HermesRuntimeService;
	let sender: FakeSendService;
	let connectionId: string;

	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		client = new FakeRuntimeClient();
		rest = new FakeRestClient();
		sender = new FakeSendService();
		rest.sessions = [session()];
		const vault = new HermesTokenVault({
			isEncryptionAvailable: () => true,
			encryptString: (value) => Buffer.from(value),
			decryptString: (value) => value.toString(),
		});
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
			clientFactory: () => client,
			restClientFactory: () => rest,
			sendService: sender,
			tokenVault: vault,
		});
	});

	afterEach(() => {
		service.shutdown();
		_setDbForTesting(null);
	});

	test("connects without protocol.info or fork-only catalog and browses over REST", async () => {
		const catalog = await service.connect(connectionId);

		expect(catalog.sessions.map((item) => item.id)).toEqual(["stored-1"]);
		expect(catalog.compatibility.state).toBe("compatible");
		expect(client.requests).toEqual([]);
		expect(rest.listCalls).toBe(1);
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

	test("creates with source superiorswarm and submits only against the runtime ID", async () => {
		client.responses.set("session.create", [
			{ session_id: "runtime-new", stored_session_id: "stored-new", profile: "work" },
		]);
		client.responses.set("prompt.submit", [{ status: "streaming" }]);
		await service.connect(connectionId);

		const created = await service.create(connectionId, { cwd: "/tmp/worktree" });
		expect(await service.history(connectionId, created.durableSessionId)).toEqual({
			durableSessionId: "stored-new",
			messages: [],
		});
		await service.submit(connectionId, created.durableSessionId, "Continue");

		expect(created).toMatchObject({
			runtimeSessionId: "runtime-new",
			durableSessionId: "stored-new",
			persisted: false,
		});
		expect(client.requests).toEqual([
			{
				method: "session.create",
				params: { source: "superiorswarm", profile: "work", cwd: "/tmp/worktree" },
			},
			{
				method: "prompt.submit",
				params: { session_id: "runtime-new", text: "Continue" },
			},
		]);
		expect(JSON.stringify(client.requests)).not.toContain("claim");
		expect(rest.transcriptCalls).toEqual([]);
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
			},
		]);
		expect(client.requests.filter((request) => request.method === "session.resume")).toHaveLength(
			2
		);
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
