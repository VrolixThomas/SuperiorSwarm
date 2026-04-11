import { beforeEach, describe, expect, mock, test } from "bun:test";

type IpcHandler = (...args: unknown[]) => unknown;

const invokeHandlers = new Map<string, IpcHandler>();
const eventHandlers = new Map<string, IpcHandler>();

const mockServerManager = {
	setMainWindow: mock(() => {}),
	getSupport: mock(
		() =>
			({
				supported: false,
				reason: "unconfigured",
			}) as const
	),
	getHealth: mock(() => []),
	findConfig: mock(() => undefined),
	getOrCreate: mock(async () => null),
	getConnection: mock(() => null),
	trackDocument: mock(() => {}),
	untrackDocument: mock(() => {}),
};

mock.module("electron", () => ({
	ipcMain: {
		handle: (name: string, fn: IpcHandler) => invokeHandlers.set(name, fn),
		on: (name: string, fn: IpcHandler) => eventHandlers.set(name, fn),
	},
}));

mock.module("../src/main/logger", () => ({
	log: {
		info: mock(() => {}),
		error: mock(() => {}),
	},
}));

mock.module("../src/main/lsp/server-manager", () => ({
	serverManager: mockServerManager,
}));

const { setupLspIPC } = await import("../src/main/lsp/ipc-handler");

describe("lsp IPC handlers", () => {
	beforeEach(() => {
		invokeHandlers.clear();
		eventHandlers.clear();
		mockServerManager.setMainWindow.mockClear();
		mockServerManager.getSupport.mockReset();
		mockServerManager.getSupport.mockImplementation(
			() =>
				({
					supported: false,
					reason: "unconfigured",
				}) as const
		);
		mockServerManager.getHealth.mockReset();
		mockServerManager.getHealth.mockImplementation(() => []);
		mockServerManager.findConfig.mockReset();
		mockServerManager.findConfig.mockImplementation(() => undefined);
		mockServerManager.getOrCreate.mockReset();
		mockServerManager.getOrCreate.mockImplementation(async () => null);
		mockServerManager.getConnection.mockReset();
		mockServerManager.getConnection.mockImplementation(() => null);
		mockServerManager.trackDocument.mockClear();
		mockServerManager.untrackDocument.mockClear();
	});

	test("lsp:getSupport returns unsupported when no config matches", async () => {
		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:getSupport");
		expect(handler).toBeDefined();

		const result = await handler?.(
			{},
			{ repoPath: "/tmp/repo", languageId: "elixir", filePath: "lib/a.ex" }
		);
		expect(result).toEqual({ supported: false, reason: "unconfigured" });
	});

	test("lsp:getSupport returns supported shape with serverId", async () => {
		mockServerManager.getSupport.mockImplementation(
			() =>
				({
					supported: true,
					reason: "language",
					config: {
						id: "go",
						command: "gopls",
						args: [],
						languages: ["go"],
						fileExtensions: [".go"],
					},
				}) as const
		);

		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:getSupport");
		expect(handler).toBeDefined();

		const result = await handler?.(
			{},
			{ repoPath: "/tmp/repo", languageId: "go", filePath: "main.go" }
		);
		expect(result).toEqual({ supported: true, serverId: "go", reason: "language" });
	});

	test("lsp:getHealth returns health entries for repo", async () => {
		mockServerManager.getHealth.mockImplementation(() => [
			{ id: "go", command: "gopls", available: true },
			{ id: "rust", command: "rust-analyzer", available: false },
		]);

		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:getHealth");
		expect(handler).toBeDefined();

		const result = await handler?.({}, { repoPath: "/tmp/repo" });
		expect(result).toEqual({
			entries: [
				{ id: "go", command: "gopls", available: true },
				{ id: "rust", command: "rust-analyzer", available: false },
			],
		});
	});

	test("lsp:request behavior remains compatible for missing config", async () => {
		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:request");
		expect(handler).toBeDefined();

		const result = await handler?.(
			{},
			{
				languageId: "elixir",
				repoPath: "/tmp/repo",
				method: "textDocument/hover",
				params: {},
			}
		);

		expect(result).toEqual({ error: "No language server for elixir" });
	});
});
