import { beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
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

const defaultConfigs: MockConfig[] = [];
const userConfigs: MockConfig[] = [];
const repoConfigs = new Map<string, MockConfig[]>();
const unavailableCommands = new Set<string>();
const spawnCalls: string[] = [];

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

mock.module("../src/main/lsp/registry", () => ({
	DEFAULT_SERVER_CONFIGS: defaultConfigs,
	loadUserConfig: () => userConfigs,
	loadRepoConfig: (repoPath: string) => repoConfigs.get(repoPath) ?? [],
	buildRegistry: ({
		defaults,
		user,
		repo,
	}: { defaults: MockConfig[]; user: MockConfig[]; repo: MockConfig[] }) => {
		const byId = new Map<string, MockConfig>();
		for (const config of defaults) {
			byId.set(config.id, config);
		}
		for (const config of user) {
			byId.set(config.id, config);
		}
		for (const config of repo) {
			byId.set(config.id, config);
		}
		return { byId };
	},
	resolveSupport: (
		registry: { byId: Map<string, MockConfig> },
		{ languageId }: { languageId: string; filePath: string }
	) => {
		const config = registry.byId.get(languageId);
		if (!config || config.disabled) {
			return { supported: false as const };
		}

		return {
			supported: true as const,
			reason: "language" as const,
			config,
		};
	},
}));

const { ServerManager } = await import("../src/main/lsp/server-manager");

describe("ServerManager repo-aware resolution", () => {
	beforeEach(() => {
		repoConfigs.clear();
		unavailableCommands.clear();
		spawnCalls.length = 0;
		defaultConfigs.length = 0;
		userConfigs.length = 0;
	});

	test("findConfig resolves overrides per repo path", () => {
		const manager = new ServerManager();
		const repoA = "/tmp/ss-repo-a";
		const repoB = "/tmp/ss-repo-b";

		repoConfigs.set(repoA, [buildConfig("python", "repo-a-pyright")]);
		repoConfigs.set(repoB, [buildConfig("python", "repo-b-pyright")]);

		const configA = manager.findConfig("python", repoA, "file.py");
		const configB = manager.findConfig("python", repoB, "file.py");

		expect(configA?.command).toBe("repo-a-pyright");
		expect(configB?.command).toBe("repo-b-pyright");
	});

	test("spawn failures are scoped per repo and config", async () => {
		const manager = new ServerManager();
		const repoA = "/tmp/ss-repo-fail";
		const repoB = "/tmp/ss-repo-ok";

		repoConfigs.set(repoA, [buildConfig("python", "missing-pyright")]);
		repoConfigs.set(repoB, [buildConfig("python", "working-pyright")]);
		unavailableCommands.add("missing-pyright");

		const failedConnection = await manager.getOrCreate("python", repoA);
		const healthyConnection = await manager.getOrCreate("python", repoB);

		expect(failedConnection).toBeNull();
		expect(healthyConnection).not.toBeNull();
		expect(spawnCalls).toEqual(["missing-pyright", "working-pyright"]);

		await manager.disposeAll();
	});
});
