import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	buildHermesBackendLaunch,
	hermesExecutableCandidates,
	normalizeHermesHomeRoot,
} from "../src/main/hermes/hermes-cli";
import {
	type HermesBackendChild,
	HermesLocalBackendManager,
} from "../src/main/hermes/hermes-local-backend-manager";

class FakeChild extends EventEmitter implements HermesBackendChild {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly pid: number;
	exitCode: number | null = null;
	killed = false;
	readonly killSignals: NodeJS.Signals[] = [];

	constructor(pid: number) {
		super();
		this.pid = pid;
	}

	kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
		this.killed = true;
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

interface Invocation {
	executable: string;
	argv: string[];
	options: {
		shell: false;
		stdio: ["ignore", "pipe", "pipe"];
		env: NodeJS.ProcessEnv;
	};
}

const managers: HermesLocalBackendManager[] = [];

afterEach(() => {
	for (const manager of managers.splice(0)) manager.shutdown();
});

function testManager(input: {
	children: FakeChild[];
	invocations?: Invocation[];
	token?: string;
	timeoutMs?: number;
	maxOutputBytes?: number;
}): HermesLocalBackendManager {
	let nextPid = 41_000;
	const manager = new HermesLocalBackendManager({
		executableResolver: () => "/opt/hermes/bin/hermes",
		hermesHomeResolver: () => "/Users/test/.hermes",
		tokenFactory: () => input.token ?? "spawn-session-secret",
		spawnProcess: (executable, argv, options) => {
			input.invocations?.push({ executable, argv, options });
			const child = new FakeChild(nextPid++);
			input.children.push(child);
			return child;
		},
		dashboardTokenResolver: async () => "served-session-secret",
		runtimeVerifier: async () => undefined,
		portAnnounceTimeoutMs: input.timeoutMs,
		maxOutputBytes: input.maxOutputBytes,
	});
	managers.push(manager);
	return manager;
}

function announceReady(child: FakeChild, port: number): void {
	queueMicrotask(() => {
		child.stdout.emit("data", Buffer.from(`HERMES_BACKEND_READY port=${port}\n`));
	});
}

describe("HermesLocalBackendManager", () => {
	test("constructs stock serve argv without creating profiles/default or profiles/custom", () => {
		expect(
			hermesExecutableCandidates(
				{ HERMES_EXECUTABLE: "/explicit/hermes", PATH: "/first:/second" },
				"/Users/test"
			)
		).toEqual([
			"/explicit/hermes",
			"/first/hermes",
			"/second/hermes",
			"/Users/test/.local/bin/hermes",
			"/Users/test/.hermes/bin/hermes",
		]);
		expect(buildHermesBackendLaunch("default", "/Users/test/.hermes")).toEqual({
			argv: ["serve", "--host", "127.0.0.1", "--port", "0"],
			hermesHome: "/Users/test/.hermes",
		});
		expect(buildHermesBackendLaunch("custom", "/Users/test/.hermes")).toEqual({
			argv: ["serve", "--host", "127.0.0.1", "--port", "0"],
			hermesHome: "/Users/test/.hermes",
		});
		expect(buildHermesBackendLaunch("work", "/Users/test/.hermes")).toEqual({
			argv: ["--profile", "work", "serve", "--host", "127.0.0.1", "--port", "0"],
			hermesHome: "/Users/test/.hermes",
		});
		expect(normalizeHermesHomeRoot("/Users/test/.hermes/profiles/work")).toBe(
			"/Users/test/.hermes"
		);
	});

	test("singleflights one owned child per profile and keeps the token out of argv and descriptors", async () => {
		const children: FakeChild[] = [];
		const invocations: Invocation[] = [];
		const manager = testManager({ children, invocations, token: "spawn-session-secret" });

		const first = manager.ensure("default");
		const second = manager.ensure("default");
		expect(first).toBe(second);
		expect(children).toHaveLength(1);
		const child = children[0];
		expect(child).toBeDefined();
		announceReady(child as FakeChild, 54_321);

		const [left, right] = await Promise.all([first, second]);
		expect(left).toEqual(right);
		expect(left.baseUrl).toBe("http://127.0.0.1:54321");
		expect(invocations[0]).toMatchObject({
			executable: "/opt/hermes/bin/hermes",
			argv: ["serve", "--host", "127.0.0.1", "--port", "0"],
			options: { shell: false, stdio: ["ignore", "pipe", "pipe"] },
		});
		const environment = invocations[0]?.options.env;
		expect(environment?.["HERMES_HOME"]).toBe("/Users/test/.hermes");
		expect(environment?.["HERMES_DASHBOARD_SESSION_TOKEN"]).toBe("spawn-session-secret");
		expect(environment?.["HERMES_DESKTOP"]).toBeUndefined();
		expect(JSON.stringify(invocations[0]?.argv)).not.toContain("spawn-session-secret");
		expect(JSON.stringify(manager.describeOwnedBackends())).not.toContain("session-secret");
	});

	test("drops an exited owned child and starts a fresh child on the next ensure", async () => {
		const children: FakeChild[] = [];
		const manager = testManager({ children });
		const first = manager.ensure("work");
		announceReady(children[0] as FakeChild, 51_001);
		await first;
		children[0]?.exit(1, null);

		const restarted = manager.ensure("work");
		expect(children).toHaveLength(2);
		announceReady(children[1] as FakeChild, 51_002);
		expect((await restarted).baseUrl).toBe("http://127.0.0.1:51002");
	});

	test("bounds startup time and output while returning content-free errors", async () => {
		const timeoutChildren: FakeChild[] = [];
		const timeoutManager = testManager({ children: timeoutChildren, timeoutMs: 5 });
		await expect(timeoutManager.ensure("default")).rejects.toThrow("Stock Hermes failed to start");
		expect(timeoutChildren[0]?.killed).toBe(true);

		const outputChildren: FakeChild[] = [];
		const outputManager = testManager({ children: outputChildren, maxOutputBytes: 64 });
		const starting = outputManager.ensure("default");
		outputChildren[0]?.stderr.emit("data", Buffer.from(`token=provider-secret\n${"x".repeat(80)}`));
		try {
			await starting;
			expect.unreachable("oversized child output must fail");
		} catch (error) {
			expect((error as Error).message).toContain("Stock Hermes failed to start");
			expect((error as Error).message).not.toContain("provider-secret");
		}
		expect(outputChildren[0]?.killed).toBe(true);
	});

	test("shutdown kills only owned children and removes startup listeners", async () => {
		const children: FakeChild[] = [];
		const manager = testManager({ children });
		const starting = manager.ensure("default");
		announceReady(children[0] as FakeChild, 52_001);
		await starting;

		manager.shutdown();
		await Bun.sleep(0);
		expect(children[0]?.killSignals).toEqual(["SIGTERM"]);
		expect(manager.describeOwnedBackends()).toEqual([]);
		expect(children[0]?.stdout.listenerCount("data")).toBe(0);
		expect(children[0]?.stderr.listenerCount("data")).toBe(0);
	});

	test("adopts an announced ephemeral endpoint and verifies real REST plus WebSocket auth", async () => {
		const servedToken = "fixture-served-session-token";
		let statusAuthenticated = false;
		let webSocketAuthenticated = false;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, bunServer) {
				const url = new URL(request.url);
				if (url.pathname === "/") {
					return new Response(
						`<script>window.__HERMES_SESSION_TOKEN__ = ${JSON.stringify(servedToken)};</script>`,
						{ headers: { "Content-Type": "text/html" } }
					);
				}
				if (url.pathname === "/api/status") {
					statusAuthenticated = request.headers.get("X-Hermes-Session-Token") === servedToken;
					return statusAuthenticated
						? Response.json({ status: "ok" })
						: Response.json({ error: "unauthorized" }, { status: 401 });
				}
				if (url.pathname === "/api/ws" && url.searchParams.get("token") === servedToken) {
					webSocketAuthenticated = true;
					if (bunServer.upgrade(request)) return undefined;
				}
				return new Response("Not found", { status: 404 });
			},
			websocket: {
				open(socket) {
					socket.send(JSON.stringify({ type: "gateway.ready" }));
				},
				message() {},
			},
		});
		const children: FakeChild[] = [];
		const manager = new HermesLocalBackendManager({
			executableResolver: () => "/opt/hermes/bin/hermes",
			hermesHomeResolver: () => "/tmp/hermes-fixture-home",
			tokenFactory: () => "fixture-spawn-token",
			spawnProcess: () => {
				const child = new FakeChild(42_000);
				children.push(child);
				return child;
			},
			portAnnounceTimeoutMs: 1_000,
		});
		managers.push(manager);

		const starting = manager.ensure("default");
		announceReady(children[0] as FakeChild, server.port);
		const runtime = await starting;

		expect(runtime.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
		expect(runtime.baseUrl).not.toContain(":8080");
		expect(statusAuthenticated).toBe(true);
		expect(webSocketAuthenticated).toBe(true);
		manager.shutdown();
		await Bun.sleep(0);
		server.stop(true);
		expect(children[0]?.exitCode).not.toBeNull();
	});

	test("retains the main-generated token when stock serve has no dashboard SPA", async () => {
		const spawnToken = "fixture-headless-spawn-token";
		let statusAuthenticated = false;
		let webSocketAuthenticated = false;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, bunServer) {
				const url = new URL(request.url);
				if (url.pathname === "/") {
					return Response.json({ error: "headless" }, { status: 404 });
				}
				if (url.pathname === "/api/status") {
					statusAuthenticated = request.headers.get("X-Hermes-Session-Token") === spawnToken;
					return statusAuthenticated
						? Response.json({ status: "ok" })
						: Response.json({ error: "unauthorized" }, { status: 401 });
				}
				if (url.pathname === "/api/ws" && url.searchParams.get("token") === spawnToken) {
					webSocketAuthenticated = true;
					if (bunServer.upgrade(request)) return undefined;
				}
				return new Response("Not found", { status: 404 });
			},
			websocket: {
				open(socket) {
					socket.send(JSON.stringify({ type: "gateway.ready" }));
				},
				message() {},
			},
		});
		const children: FakeChild[] = [];
		const manager = new HermesLocalBackendManager({
			executableResolver: () => "/opt/hermes/bin/hermes",
			hermesHomeResolver: () => "/tmp/hermes-headless-fixture-home",
			tokenFactory: () => spawnToken,
			spawnProcess: () => {
				const child = new FakeChild(42_001);
				children.push(child);
				return child;
			},
			portAnnounceTimeoutMs: 1_000,
		});
		managers.push(manager);

		const starting = manager.ensure("default");
		announceReady(children[0] as FakeChild, server.port);
		const runtime = await starting;

		expect(runtime.token).toBe(spawnToken);
		expect(statusAuthenticated).toBe(true);
		expect(webSocketAuthenticated).toBe(true);
		manager.shutdown();
		await Bun.sleep(0);
		server.stop(true);
	});
});
