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
	installHint?: string;
	rootMarkers: string[];
	disabled: boolean;
};

const unavailableCommands = new Set<string>();
const initFailCommands = new Set<string>();
const spawnCalls: string[] = [];
const createdRepos: string[] = [];
const originalPath = process.env["PATH"];
const originalPathExt = process.env["PATHEXT"];

function buildConfig(id: string, command: string, installHint?: string): MockConfig {
	return {
		id,
		command,
		args: ["--stdio"],
		languages: [id],
		fileExtensions: [`.${id}`],
		installHint,
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

mock.module("vscode-languageserver-protocol/node.js", () => ({
	createMessageConnection: mock(() => ({
		listen: () => {},
		sendRequest: async (method: string) => {
			const lastCommand = spawnCalls[spawnCalls.length - 1];
			if (method === "initialize" && lastCommand && initFailCommands.has(lastCommand)) {
				throw new Error(`Init failed for ${lastCommand}`);
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
		expect(health).toContainEqual({
			id: "rust",
			command: "definitely-not-installed-lsp-binary",
			available: false,
			lastError: "Executable not found: definitely-not-installed-lsp-binary",
			activeSessions: 0,
			activeSessionDocuments: [],
			installHint:
				"Install 'definitely-not-installed-lsp-binary' and ensure it is available on PATH.",
		});
	});

	test("getHealth includes active sessions and custom install hint", async () => {
		const manager = new ServerManager();
		const repoPath = createRepoWithConfig("health-active", [
			buildConfig("python", process.execPath, "Install pyright with `bun add -g pyright`"),
		]);

		const connection = await manager.getOrCreate("python", repoPath);
		expect(connection).not.toBeNull();
		manager.trackDocument("python", repoPath, "file:///tmp/repo/src/main.py");

		const health = manager.getHealth(repoPath);
		expect(health).toContainEqual({
			id: "python",
			command: process.execPath,
			available: true,
			activeSessions: 1,
			activeSessionDocuments: ["file:///tmp/repo/src/main.py"],
			installHint: "Install pyright with `bun add -g pyright`",
		});

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
});
