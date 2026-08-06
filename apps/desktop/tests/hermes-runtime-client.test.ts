import { describe, expect, test } from "bun:test";
import { HermesRuntimeClient } from "../src/main/hermes/hermes-runtime-client";

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
		const request = client.request("session.catalog", {});
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
		const request = client.request("session.history", {}, { signal: abort.signal });
		abort.abort();

		await expect(request).rejects.toThrow("cancelled");
		const sent = JSON.parse(socket?.sent[0] ?? "{}") as { id: string };
		socket?.message({ jsonrpc: "2.0", id: sent.id, result: { messages: [] } });
		expect(client.getPendingRequestCount()).toBe(0);
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
