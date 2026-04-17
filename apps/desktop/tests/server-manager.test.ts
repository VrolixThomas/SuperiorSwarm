import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

type MockConfig = {
	id: string;
	command: string;
	args: string[];
	languages: string[];
	fileExtensions: string[];
	rootMarkers: string[];
	disabled: boolean;
	initializationOptions?: Record<string, unknown>;
};

const unavailableCommands = new Set<string>();
const initFailCommands = new Set<string>();
const spawnCalls: string[] = [];
const createdRepos: string[] = [];
let capturedInitParams: unknown = null;
const originalPath = process.env["PATH"];
const originalPathExt = process.env["PATHEXT"];

function buildConfig(id: string, command: string): MockConfig {
	return {
		id,
		command,
		args: ["--stdio"],
		languages: [id],
		fileExtensions: [`.${id}`],
		rootMarkers: [".git"],
		disabled: false,
	};
}

mock.module("node:child_process", () => ({
	spawn: mock((command: string) => {
		spawnCalls.push(command);

		const proc = new EventEmitter() as EventEmitter & {
			stdin: PassThrough;
			stdout: PassThrough;
			stderr: PassThrough;
			kill: () => boolean;
		};
		proc.stdin = new PassThrough();
		proc.stdout = new PassThrough();
		proc.stderr = new PassThrough();
		proc.kill = () => {
			proc.emit("exit", 0);
			return true;
		};

		queueMicrotask(() => {
			if (unavailableCommands.has(command)) {
				proc.emit("error", new Error(`spawn ${command} ENOENT`));
				return;
			}
			proc.emit("spawn");
		});

		return proc;
	}),
	execSync: mock(() => ""),
}));

mock.module("../src/main/lsp/trust", () => ({
	getRepoTrust: () => ({ trusted: true, decided: true }),
	setRepoTrust: () => {},
}));

let initializeResponse: unknown = {};
mock.module("vscode-languageserver-protocol/node.js", () => ({
	createMessageConnection: mock(() => ({
		listen: () => {},
		sendRequest: async (method: string, params: unknown) => {
			const lastCommand = spawnCalls[spawnCalls.length - 1];
			if (method === "initialize" && lastCommand && initFailCommands.has(lastCommand)) {
				throw new Error(`Init failed for ${lastCommand}`);
			}
			if (method === "initialize") {
				capturedInitParams = params;
				return initializeResponse;
			}
			return {};
		},
		sendNotification: () => {},
		onNotification: () => {},
		dispose: () => {},
	})),
}));

const { ServerManager, _resetShellPathCacheForTests } = await import(
	"../src/main/lsp/server-manager"
);

function createRepoWithConfig(name: string, configs: MockConfig[]): string {
	const repoPath = mkdtempSync(join(tmpdir(), `ss-server-manager-${name}-`));
	mkdirSync(join(repoPath, ".superiorswarm"), { recursive: true });
	writeFileSync(join(repoPath, ".superiorswarm", "lsp.json"), JSON.stringify({ servers: configs }));
	createdRepos.push(repoPath);
	return repoPath;
}

describe("ServerManager repo-aware resolution", () => {
	beforeEach(() => {
		unavailableCommands.clear();
		initFailCommands.clear();
		spawnCalls.length = 0;
		capturedInitParams = null;
		_resetShellPathCacheForTests();
	});

	afterEach(() => {
		process.env["PATH"] = originalPath;
		process.env["PATHEXT"] = originalPathExt;

		for (const repoPath of createdRepos.splice(0)) {
			rmSync(repoPath, { recursive: true, force: true });
		}
	});

	test("findConfig resolves overrides per repo path", () => {
		const manager = new ServerManager();
		const repoA = createRepoWithConfig("a", [buildConfig("python", "repo-a-pyright")]);
		const repoB = createRepoWithConfig("b", [buildConfig("python", "repo-b-pyright")]);

		const configA = manager.findConfig("python", repoA, "file.py");
		const configB = manager.findConfig("python", repoB, "file.py");

		expect(configA?.command).toBe("repo-a-pyright");
		expect(configB?.command).toBe("repo-b-pyright");
	});

	test("spawn failures are scoped per repo and config", async () => {
		const manager = new ServerManager();
		const repoA = createRepoWithConfig("fail", [buildConfig("python", "missing-pyright")]);
		const repoB = createRepoWithConfig("ok", [buildConfig("python", "working-pyright")]);

		unavailableCommands.add("missing-pyright");

		const failedConnection = await manager.getOrCreate("python", repoA);
		const failedConnectionAgain = await manager.getOrCreate("python", repoA);
		const healthyConnection = await manager.getOrCreate("python", repoB);

		expect(failedConnection).toBeNull();
		expect(failedConnectionAgain).toBeNull();
		expect(healthyConnection).not.toBeNull();
		expect(spawnCalls).toEqual(["missing-pyright", "working-pyright"]);

		await manager.disposeAll();
	});

	test("getSupport reports missing-binary when executable is unavailable", () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("support", [
			buildConfig("rust", "definitely-not-installed-lsp-binary"),
		]);

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: false, reason: "missing-binary" });
	});

	test("getHealth marks missing executables unavailable before spawn attempt", () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("health-missing", [
			buildConfig("rust", "definitely-not-installed-lsp-binary"),
		]);

		const health = manager.getHealth(repoPath);
		expect(health).toContainEqual(
			expect.objectContaining({
				id: "rust",
				command: "definitely-not-installed-lsp-binary",
				available: false,
				lastError: "Executable not found: definitely-not-installed-lsp-binary",
				activeSessions: 0,
				activeSessionDocuments: [],
			})
		);
	});

	test("getHealth includes active sessions", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("health-active", [
			buildConfig("python", process.execPath),
		]);

		const connection = await manager.getOrCreate("python", repoPath);
		expect(connection).not.toBeNull();
		manager.trackDocument("python", repoPath, "file:///tmp/repo/src/main.py");

		const health = manager.getHealth(repoPath);
		expect(health).toContainEqual(
			expect.objectContaining({
				id: "python",
				command: process.execPath,
				available: true,
				activeSessions: 1,
				activeSessionDocuments: ["file:///tmp/repo/src/main.py"],
			})
		);

		await manager.disposeAll();
	});

	test("getHealth includes last startup error from failed spawn", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("health-startup-error", [
			buildConfig("python", "missing-startup-lsp"),
		]);

		unavailableCommands.add("missing-startup-lsp");
		await manager.getOrCreate("python", repoPath);

		const health = manager.getHealth(repoPath);
		expect(health).toContainEqual(
			expect.objectContaining({
				id: "python",
				command: "missing-startup-lsp",
				available: false,
				lastStartupError: "spawn missing-startup-lsp ENOENT",
			})
		);
	});

	test("getSupport resolves bare commands with PATHEXT on Windows", () => {
		const manager = new ServerManager() as unknown as {
			isWindowsPlatform: () => boolean;
			getSupport: InstanceType<typeof ServerManager>["getSupport"];
		};
		manager.isWindowsPlatform = () => true;

		const repoPath = createRepoWithConfig("support-win", [
			buildConfig("rust", "win-rust-analyzer"),
		]);
		const binPath = mkdtempSync(join(tmpdir(), "ss-server-manager-bin-"));
		const windowsCommand = join(binPath, "win-rust-analyzer.CMD");
		writeFileSync(windowsCommand, "@echo off\n");
		chmodSync(windowsCommand, 0o755);
		createdRepos.push(binPath);

		process.env["PATH"] = binPath;
		process.env["PATHEXT"] = ".COM;.EXE;.BAT;.CMD";

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: true, reason: "language" });
	});

	test("getSupport reports missing-binary when PATHEXT does not include command extension", () => {
		const manager = new ServerManager() as unknown as {
			isWindowsPlatform: () => boolean;
			getSupport: InstanceType<typeof ServerManager>["getSupport"];
		};
		manager.isWindowsPlatform = () => true;

		const repoPath = createRepoWithConfig("support-win-missing", [
			buildConfig("rust", "win-rust-analyzer"),
		]);
		const binPath = mkdtempSync(join(tmpdir(), "ss-server-manager-bin-missing-"));
		const windowsCommand = join(binPath, "win-rust-analyzer.CMD");
		writeFileSync(windowsCommand, "@echo off\n");
		chmodSync(windowsCommand, 0o755);
		createdRepos.push(binPath);

		process.env["PATH"] = binPath;
		process.env["PATHEXT"] = ".EXE";

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: false, reason: "missing-binary" });
	});

	test("init failures do not consume crash budget", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("counter", [buildConfig("flaky", "flaky-lsp")]);

		// Cause initialize() to throw — this exercises the init-failure path
		initFailCommands.add("flaky-lsp");

		// Two init failures (handshake fails after spawn)
		await manager.getOrCreate("flaky", repoPath);
		await manager.getOrCreate("flaky", repoPath);

		// @ts-expect-error private access for test
		const crashCount =
			(manager["crashCounts"] as Map<string, number>).get(`flaky:${repoPath}`) ?? 0;
		expect(crashCount).toBe(0);

		// @ts-expect-error private access for test
		const initFailCount =
			(manager["initFailures"] as Map<string, number>).get(`flaky:${repoPath}`) ?? 0;
		expect(initFailCount).toBeGreaterThanOrEqual(1);
	});

	test("getSupport observes consistent availability state across repeated calls", () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("ghost", [buildConfig("ghost", "ghost-cmd")]);

		const r1 = manager.getSupport(repoPath, "ghost", join(repoPath, "a.ghost"));
		// @ts-expect-error private access
		const snap1 = new Map(manager["serverLastErrors"] as Map<string, string>);

		const r2 = manager.getSupport(repoPath, "ghost", join(repoPath, "a.ghost"));
		// @ts-expect-error private access
		const snap2 = new Map(manager["serverLastErrors"] as Map<string, string>);

		expect(r1.supported).toBe(false);
		expect(r2.supported).toBe(false);
		if (!r1.supported) expect(r1.reason).toBe("missing-binary");

		// snap1 must have at least one entry — if serverLastErrors is never populated this catches it
		expect(snap1.size).toBeGreaterThanOrEqual(1);
		// Locate the ghost-server key and confirm the generic probe message landed.
		// Key format is `${configId}:${repoPath}` — "ghost:<repoPath>" in this test.
		const ghostKey = `ghost:${repoPath}`;
		expect(snap1.get(ghostKey)).toMatch(/Executable not found/i);

		// The two calls must observe the same bookkeeping state
		expect([...snap2.entries()].sort()).toEqual([...snap1.entries()].sort());
	});

	test("getSupport resolves dotted relative paths with PATHEXT on Windows", () => {
		const manager = new ServerManager() as unknown as {
			isWindowsPlatform: () => boolean;
			getSupport: InstanceType<typeof ServerManager>["getSupport"];
		};
		manager.isWindowsPlatform = () => true;

		const repoPath = createRepoWithConfig("support-win-dotted-path", [
			buildConfig("rust", "./.lsp-bin/win-rust-analyzer"),
		]);
		mkdirSync(join(repoPath, ".lsp-bin"), { recursive: true });
		const windowsCommand = join(repoPath, ".lsp-bin", "win-rust-analyzer.CMD");
		writeFileSync(windowsCommand, "@echo off\n");
		chmodSync(windowsCommand, 0o755);

		process.env["PATHEXT"] = ".COM;.EXE;.BAT;.CMD";

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: true, reason: "language" });
	});

	test("forwards initializationOptions to the initialize request", async () => {
		const manager = new ServerManager();
		const configWithOpts: MockConfig = {
			id: "withopts",
			command: process.execPath,
			args: [],
			languages: ["withopts"],
			fileExtensions: [".withopts"],
			rootMarkers: [".git"],
			disabled: false,
			initializationOptions: { foo: "bar", nested: { x: 1 } },
		};
		const repoPath = createRepoWithConfig("initopts", [configWithOpts]);

		capturedInitParams = null;
		await manager.getOrCreate("withopts", repoPath);

		expect(capturedInitParams).not.toBeNull();
		const params = capturedInitParams as {
			initializationOptions?: { foo: string; nested: { x: number } };
		};
		expect(params.initializationOptions).toEqual({ foo: "bar", nested: { x: 1 } });

		await manager.disposeAll();
	});

	test("evictServer disposes running connection and clears failure state", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("evict", [buildConfig("evictme", process.execPath)]);

		const firstConnection = await manager.getOrCreate("evictme", repoPath);
		expect(firstConnection).not.toBeNull();

		// Populate failure state to assert it's cleared on evict
		// @ts-expect-error private access for test
		(manager["serverLastStartupErrors"] as Map<string, string>).set(
			`evictme:${repoPath}`,
			"prior error"
		);
		// @ts-expect-error private access for test
		(manager["initFailures"] as Map<string, number>).set(`evictme:${repoPath}`, 2);
		// @ts-expect-error private access for test
		(manager["unavailableServers"] as Set<string>).add(`evictme:${repoPath}`);

		await manager.evictServer("evictme", repoPath);

		// @ts-expect-error private access
		expect((manager["servers"] as Map<string, unknown>).has(`evictme:${repoPath}`)).toBe(false);
		// @ts-expect-error private access
		expect(
			(manager["serverLastStartupErrors"] as Map<string, string>).has(`evictme:${repoPath}`)
		).toBe(false);
		// @ts-expect-error private access
		expect((manager["initFailures"] as Map<string, number>).has(`evictme:${repoPath}`)).toBe(false);
		// @ts-expect-error private access
		expect((manager["unavailableServers"] as Set<string>).has(`evictme:${repoPath}`)).toBe(false);

		const secondConnection = await manager.getOrCreate("evictme", repoPath);
		expect(secondConnection).not.toBeNull();

		// Two spawns happened: one for first connection, one after evict
		expect(spawnCalls.filter((c) => c === process.execPath)).toHaveLength(2);

		await manager.disposeAll();
	});

	test("evictServer with no repoPath evicts matching id across all repos", async () => {
		const manager = new ServerManager();
		const repoA = createRepoWithConfig("multi-a", [buildConfig("shared", process.execPath)]);
		const repoB = createRepoWithConfig("multi-b", [buildConfig("shared", process.execPath)]);

		await manager.getOrCreate("shared", repoA);
		await manager.getOrCreate("shared", repoB);

		// @ts-expect-error private access
		expect((manager["servers"] as Map<string, unknown>).has(`shared:${repoA}`)).toBe(true);
		// @ts-expect-error private access
		expect((manager["servers"] as Map<string, unknown>).has(`shared:${repoB}`)).toBe(true);

		await manager.evictServer("shared");

		// @ts-expect-error private access
		expect((manager["servers"] as Map<string, unknown>).has(`shared:${repoA}`)).toBe(false);
		// @ts-expect-error private access
		expect((manager["servers"] as Map<string, unknown>).has(`shared:${repoB}`)).toBe(false);

		await manager.disposeAll();
	});

	test("diffChangedIds detects command changes, init-option changes, and removals", () => {
		const manager = new ServerManager();
		const changed = manager.diffChangedIds(
			[
				{
					id: "one",
					command: "foo",
					args: [],
					languages: ["x"],
					fileExtensions: [".x"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
				},
				{
					id: "two",
					command: "bar",
					args: [],
					languages: ["y"],
					fileExtensions: [".y"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
					initializationOptions: { a: 1 },
				},
				{
					id: "three",
					command: "baz",
					args: [],
					languages: ["z"],
					fileExtensions: [".z"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
				},
			],
			[
				// one: command changed
				{
					id: "one",
					command: "foo-v2",
					args: [],
					languages: ["x"],
					fileExtensions: [".x"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
				},
				// two: init options changed
				{
					id: "two",
					command: "bar",
					args: [],
					languages: ["y"],
					fileExtensions: [".y"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
					initializationOptions: { a: 2 },
				},
				// three: removed
			]
		);

		expect([...changed].sort()).toEqual(["one", "three", "two"]);
	});

	test("diffChangedIds ignores unchanged servers", () => {
		const manager = new ServerManager();
		const cfg = {
			id: "stable",
			command: "foo",
			args: ["--stdio"],
			languages: ["x"],
			fileExtensions: [".x"],
			fileNames: [],
			rootMarkers: [".git"],
			disabled: false,
		};
		const changed = manager.diffChangedIds([cfg], [{ ...cfg }]);
		expect([...changed]).toEqual([]);
	});

	test("testServer returns capabilities on successful initialize", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("test-ok", [buildConfig("testok", process.execPath)]);

		initializeResponse = {
			capabilities: { textDocumentSync: 1, completionProvider: {} },
			serverInfo: { name: "test-ls", version: "1.0.0" },
		};

		const result = await manager.testServer("testok", repoPath);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.capabilities).toEqual({ textDocumentSync: 1, completionProvider: {} });
			expect(result.serverInfo).toEqual({ name: "test-ls", version: "1.0.0" });
		}

		// Does not leave the server registered — dry-run is ephemeral
		// @ts-expect-error private access
		expect((manager["servers"] as Map<string, unknown>).has(`testok:${repoPath}`)).toBe(false);
		initializeResponse = {};
	});

	test("testServer returns ok=false when initialize throws", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("test-fail", [buildConfig("testfail", "flaky-lsp")]);

		initFailCommands.add("flaky-lsp");

		const result = await manager.testServer("testfail", repoPath);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toBeTruthy();
		}
	});

	test("testServer returns ok=false when binary is missing", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("test-missing", [
			buildConfig("testmissing", "definitely-not-installed"),
		]);

		const result = await manager.testServer("testmissing", repoPath);
		expect(result.ok).toBe(false);
	});

	test("testServer returns ok=false for unknown config id", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("test-unknown", []);

		const result = await manager.testServer("no-such-config", repoPath);
		expect(result.ok).toBe(false);
	});

	test("clearAvailabilityCache forces re-probe after PATH changes", () => {
		const manager = new ServerManager();
		const binDir = mkdtempSync(join(tmpdir(), "ss-recheck-"));
		createdRepos.push(binDir);

		process.env["PATH"] = binDir;
		_resetShellPathCacheForTests();

		const repoPath = createRepoWithConfig("recheck", [buildConfig("probeme", "my-probe-cmd")]);

		// First probe: binary missing
		let health = manager.getHealth(repoPath);
		expect(health.find((h) => h.id === "probeme")?.available).toBe(false);

		// Add the binary after initial probe
		const binPath = join(binDir, "my-probe-cmd");
		writeFileSync(binPath, "#!/bin/sh\necho\n");
		chmodSync(binPath, 0o755);

		// Still cached — reports stale
		health = manager.getHealth(repoPath);
		expect(health.find((h) => h.id === "probeme")?.available).toBe(false);

		manager.clearAvailabilityCache("probeme", repoPath);

		// After cache cleared: detects the new binary
		health = manager.getHealth(repoPath);
		expect(health.find((h) => h.id === "probeme")?.available).toBe(true);
	});

	test("getHealth reports available=true for absolute custom binary path on unix", () => {
		const manager = new ServerManager();
		const binDir = mkdtempSync(join(tmpdir(), "ss-custom-bin-"));
		const binPath = join(binDir, "my-custom-ls");
		writeFileSync(binPath, "#!/bin/sh\necho\n");
		chmodSync(binPath, 0o755);
		createdRepos.push(binDir);

		const repoPath = createRepoWithConfig("custom-bin", [
			{ ...buildConfig("custom", binPath), command: binPath },
		]);

		const health = manager.getHealth(repoPath);
		const entry = health.find((h) => h.id === "custom");
		expect(entry?.available).toBe(true);
	});

	test("getHealth reports the PATH that was searched", () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("health-path", [
			buildConfig("pathvis", "definitely-missing-ls"),
		]);

		const health = manager.getHealth(repoPath);
		const entry = health.find((h) => h.id === "pathvis");
		expect(entry?.searchedPath).toBeTruthy();
		expect(typeof entry?.searchedPath).toBe("string");
	});

	test("diffChangedIds flags new additions", () => {
		const manager = new ServerManager();
		const changed = manager.diffChangedIds(
			[],
			[
				{
					id: "brand-new",
					command: "foo",
					args: [],
					languages: [],
					fileExtensions: [".foo"],
					fileNames: [],
					rootMarkers: [".git"],
					disabled: false,
				},
			]
		);
		expect([...changed]).toEqual(["brand-new"]);
	});

	test("clearAvailabilityCache(configId) purges entries regardless of repoPath scope", () => {
		const manager = new ServerManager();
		const cache = (
			manager as unknown as {
				executableCache: Map<string, { available: boolean; expiresAt: number }>;
			}
		).executableCache;
		const now = Date.now();
		cache.set("somelang\u0000/tmp/repoA", { available: true, expiresAt: now + 10000 });
		cache.set("somelang\u0000/tmp/repoB", { available: true, expiresAt: now + 10000 });
		expect(cache.size).toBe(2);

		manager.clearAvailabilityCache("somelang");

		expect(cache.size).toBe(0);
	});
});
