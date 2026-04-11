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
};

const unavailableCommands = new Set<string>();
const spawnCalls: string[] = [];
const createdRepos: string[] = [];
const originalPath = process.env.PATH;
const originalPathExt = process.env.PATHEXT;

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
}));

mock.module("vscode-languageserver-protocol/node.js", () => ({
	createMessageConnection: mock(() => ({
		listen: () => {},
		sendRequest: async () => ({}),
		sendNotification: () => {},
		onNotification: () => {},
		dispose: () => {},
	})),
}));

const { ServerManager } = await import("../src/main/lsp/server-manager");

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
		spawnCalls.length = 0;
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		process.env.PATHEXT = originalPathExt;

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

	test("getSupport resolves bare commands with PATHEXT on Windows", () => {
		const manager = new ServerManager() as ServerManager & { isWindowsPlatform: () => boolean };
		manager.isWindowsPlatform = () => true;

		const repoPath = createRepoWithConfig("support-win", [
			buildConfig("rust", "win-rust-analyzer"),
		]);
		const binPath = mkdtempSync(join(tmpdir(), "ss-server-manager-bin-"));
		const windowsCommand = join(binPath, "win-rust-analyzer.CMD");
		writeFileSync(windowsCommand, "@echo off\n");
		chmodSync(windowsCommand, 0o755);
		createdRepos.push(binPath);

		process.env.PATH = binPath;
		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: true, reason: "language" });
	});

	test("getSupport reports missing-binary when PATHEXT does not include command extension", () => {
		const manager = new ServerManager() as ServerManager & { isWindowsPlatform: () => boolean };
		manager.isWindowsPlatform = () => true;

		const repoPath = createRepoWithConfig("support-win-missing", [
			buildConfig("rust", "win-rust-analyzer"),
		]);
		const binPath = mkdtempSync(join(tmpdir(), "ss-server-manager-bin-missing-"));
		const windowsCommand = join(binPath, "win-rust-analyzer.CMD");
		writeFileSync(windowsCommand, "@echo off\n");
		chmodSync(windowsCommand, 0o755);
		createdRepos.push(binPath);

		process.env.PATH = binPath;
		process.env.PATHEXT = ".EXE";

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: false, reason: "missing-binary" });
	});

	test("getSupport resolves dotted relative paths with PATHEXT on Windows", () => {
		const manager = new ServerManager() as ServerManager & { isWindowsPlatform: () => boolean };
		manager.isWindowsPlatform = () => true;

		const repoPath = createRepoWithConfig("support-win-dotted-path", [
			buildConfig("rust", "./.lsp-bin/win-rust-analyzer"),
		]);
		mkdirSync(join(repoPath, ".lsp-bin"), { recursive: true });
		const windowsCommand = join(repoPath, ".lsp-bin", "win-rust-analyzer.CMD");
		writeFileSync(windowsCommand, "@echo off\n");
		chmodSync(windowsCommand, 0o755);

		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";

		const support = manager.getSupport(repoPath, "rust", "main.rust");
		expect(support).toMatchObject({ supported: true, reason: "language" });
	});
});
