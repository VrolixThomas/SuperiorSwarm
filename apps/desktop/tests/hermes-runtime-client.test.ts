import { describe, expect, test } from "bun:test";
import { HermesRpcError, HermesRuntimeClient } from "../src/main/hermes/hermes-runtime-client";

type Listener = (event: { data?: string }) => void;

class FakeSocket {
	readonly sent: string[] = [];
	readonly listeners = new Map<string, Set<Listener>>();
	readyState = 0;

	addEventListener(type: string, listener: Listener): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		this.sent.push(data);
	}

	close(): void {
		this.readyState = 3;
		this.emit("close", {});
	}

	open(): void {
		this.readyState = 1;
		this.emit("open", {});
	}

	error(): void {
		this.emit("error", {});
	}

	message(value: unknown): void {
		this.emit("message", { data: JSON.stringify(value) });
	}

	private emit(type: string, event: { data?: string }): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

describe("HermesRuntimeClient", () => {
	test("correlates responses, redacts auth from state, and preserves event order", async () => {
		const sockets: FakeSocket[] = [];
		const client = new HermesRuntimeClient({
			socketFactory: (url) => {
				expect(url).toContain("/api/ws?token=secret-token");
				const socket = new FakeSocket();
				sockets.push(socket);
				queueMicrotask(() => socket.open());
				return socket;
			},
			reconnect: false,
		});
		const events: string[] = [];
		client.subscribe((event) => events.push(event.type));

		await client.connect({ baseUrl: "http://127.0.0.1:8080", token: "secret-token" });
		const request = client.request("session.resume", { session_id: "stored" });
		const sent = JSON.parse(sockets[0]?.sent[0] ?? "{}") as { id: string };
		sockets[0]?.message({
			jsonrpc: "2.0",
			method: "event",
			params: { type: "message.delta", session_id: "runtime", payload: { text: "Hi" } },
		});
		sockets[0]?.message({ jsonrpc: "2.0", id: sent.id, result: { sessions: [] } });

		expect(await request).toEqual({ sessions: [] });
		expect(events).toEqual(["message.delta"]);
		expect(JSON.stringify(client.getState())).not.toContain("secret-token");
	});

	test("cancels an in-flight request without consuming a later response", async () => {
		let socket: FakeSocket | undefined;
		const client = new HermesRuntimeClient({
			socketFactory: () => {
				socket = new FakeSocket();
				queueMicrotask(() => socket?.open());
				return socket;
			},
			reconnect: false,
		});
		await client.connect({ baseUrl: "http://localhost:8080", token: "token" });
		const abort = new AbortController();
		const request = client.request("prompt.submit", {}, { signal: abort.signal });
		abort.abort();

		await expect(request).rejects.toThrow("cancelled");
		const sent = JSON.parse(socket?.sent[0] ?? "{}") as { id: string };
		socket?.message({ jsonrpc: "2.0", id: sent.id, result: { messages: [] } });
		expect(client.getPendingRequestCount()).toBe(0);
	});

	test("reads retryability from the actual Hermes JSON-RPC error data envelope", async () => {
		let socket: FakeSocket | undefined;
		const client = new HermesRuntimeClient({
			socketFactory: () => {
				socket = new FakeSocket();
				queueMicrotask(() => socket?.open());
				return socket;
			},
			reconnect: false,
		});
		await client.connect({ baseUrl: "http://localhost:8080", token: "token" });
		const request = client.request("prompt.submit", {});
		const sent = JSON.parse(socket?.sent[0] ?? "{}") as { id: string };
		socket?.message({
			jsonrpc: "2.0",
			id: sent.id,
			error: {
				code: 5027,
				message:
					"origin delivery failed API_KEY=rpc-secret Authorization: Basic basic-secret https://files.test/a?X-Amz-Signature=url-secret",
				data: { retryable: true, retry_after: 7 },
			},
		});

		try {
			await request;
			expect.unreachable("request should reject");
		} catch (error) {
			expect(error).toBeInstanceOf(HermesRpcError);
			expect((error as HermesRpcError).retryable).toBe(true);
			expect((error as Error).message).not.toContain("rpc-secret");
			expect((error as Error).message).not.toContain("basic-secret");
			expect((error as Error).message).not.toContain("url-secret");
		}
	});

	test("mints a fresh single-use OAuth ticket for every socket open", async () => {
		const sockets: FakeSocket[] = [];
		const urls: string[] = [];
		let ticketNumber = 0;
		const client = new HermesRuntimeClient({
			socketFactory: (url) => {
				urls.push(url);
				const socket = new FakeSocket();
				sockets.push(socket);
				queueMicrotask(() => socket.open());
				return socket;
			},
			reconnectBaseMs: 1,
			reconnectMaxMs: 1,
		});

		await client.connect({
			baseUrl: "https://hermes.example.com",
			authMode: "oauth",
			ticketProvider: async () => `ticket-${++ticketNumber}`,
		});
		sockets[0]?.close();
		await Bun.sleep(10);

		expect(urls).toEqual([
			"wss://hermes.example.com/api/ws?ticket=ticket-1",
			"wss://hermes.example.com/api/ws?ticket=ticket-2",
		]);
		expect(JSON.stringify(client.getState())).not.toContain("ticket-");
		client.disconnect();
	});

	test("reconnects with backoff and requests a canonical history refresh", async () => {
		const sockets: FakeSocket[] = [];
		const client = new HermesRuntimeClient({
			socketFactory: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				queueMicrotask(() => socket.open());
				return socket;
			},
			reconnectBaseMs: 1,
			reconnectMaxMs: 1,
		});
		const events: string[] = [];
		client.subscribe((event) => events.push(event.type));

		await client.connect({ baseUrl: "http://localhost:8080", token: "token" });
		sockets[0]?.close();
		await Bun.sleep(10);

		expect(sockets).toHaveLength(2);
		expect(client.getState().status).toBe("connected");
		expect(events).toContain("runtime.history-refresh-required");
		client.disconnect();
	});

	test("reports an initial socket failure as an explicit error state", async () => {
		const client = new HermesRuntimeClient({
			socketFactory: () => {
				const socket = new FakeSocket();
				queueMicrotask(() => socket.error());
				return socket;
			},
			reconnect: false,
		});

		await expect(
			client.connect({ baseUrl: "http://localhost:8080", token: "token" })
		).rejects.toThrow("connection failed");
		expect(client.getState().status).toBe("error");
	});

	test("bounds an initial socket that never opens", async () => {
		const client = new HermesRuntimeClient({
			socketFactory: () => new FakeSocket(),
			reconnect: false,
			connectTimeoutMs: 5,
		});

		await expect(
			client.connect({ baseUrl: "http://localhost:8080", token: "token" })
		).rejects.toThrow("timed out");
		expect(client.getState()).toMatchObject({ status: "error" });
	});

	test("ignores a stale socket closing after a replacement connection opens", async () => {
		const sockets: FakeSocket[] = [];
		const client = new HermesRuntimeClient({
			socketFactory: () => {
				const socket = new FakeSocket();
				sockets.push(socket);
				queueMicrotask(() => socket.open());
				return socket;
			},
			reconnect: false,
		});

		await client.connect({ baseUrl: "http://localhost:8080", token: "token" });
		await client.connect({ baseUrl: "http://localhost:8080", token: "token" });
		sockets[0]?.close();

		expect(client.getState().status).toBe("connected");
		expect(client.getPendingRequestCount()).toBe(0);
		client.disconnect();
	});
});
