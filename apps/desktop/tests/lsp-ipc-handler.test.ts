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

	test("lsp:getSupport returns missing-binary reason when executable is unavailable", async () => {
		mockServerManager.getSupport.mockImplementation(
			() =>
				({
					supported: false,
					reason: "missing-binary",
					config: {
						id: "rust",
						command: "rust-analyzer",
						args: [],
						languages: ["rust"],
						fileExtensions: [".rs"],
					},
				}) as const
		);

		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:getSupport");
		expect(handler).toBeDefined();

		const result = await handler?.(
			{},
			{ repoPath: "/tmp/repo", languageId: "rust", filePath: "main.rs" }
		);
		expect(result).toEqual({ supported: false, reason: "missing-binary" });
	});

	test("lsp:getHealth returns health entries for repo", async () => {
		mockServerManager.getHealth.mockImplementation(() => [
			{
				id: "go",
				command: "gopls",
				available: true,
				lastStartupError: undefined,
				activeSessions: 1,
				activeSessionDocuments: ["file:///tmp/repo/main.go"],
			},
			{
				id: "rust",
				command: "rust-analyzer",
				available: false,
				lastError: "Executable not found: rust-analyzer",
				lastStartupError: "spawn rust-analyzer ENOENT",
				activeSessions: 0,
				activeSessionDocuments: [],
			},
		]);

		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:getHealth");
		expect(handler).toBeDefined();

		const result = await handler?.({}, { repoPath: "/tmp/repo" });
		expect(result).toEqual({
			entries: [
				{
					id: "go",
					command: "gopls",
					available: true,
					lastStartupError: undefined,
					activeSessions: 1,
					activeSessionDocuments: ["file:///tmp/repo/main.go"],
				},
				{
					id: "rust",
					command: "rust-analyzer",
					available: false,
					lastError: "Executable not found: rust-analyzer",
					lastStartupError: "spawn rust-analyzer ENOENT",
					activeSessions: 0,
					activeSessionDocuments: [],
				},
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

	test("lsp:request resolves config by file extension when languageId is unknown", async () => {
		const sendRequest = mock(async () => ({ ok: true }));
		mockServerManager.findConfig.mockImplementation(
			(languageId: string, _repoPath: string, filePath?: string) => {
				if (languageId === "unknown" && filePath === "/tmp/repo/lib/example.ex") {
					return {
						id: "elixir",
						command: "elixir-ls",
						args: [],
						languages: ["elixir"],
						fileExtensions: [".ex"],
					};
				}

				return undefined;
			}
		);
		mockServerManager.getOrCreate.mockImplementation(async () => ({ sendRequest }));

		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = invokeHandlers.get("lsp:request");
		expect(handler).toBeDefined();

		const result = await handler?.(
			{},
			{
				languageId: "unknown",
				repoPath: "/tmp/repo",
				method: "textDocument/hover",
				params: {
					textDocument: { uri: "file:///tmp/repo/lib/example.ex" },
					position: { line: 0, character: 0 },
				},
			}
		);

		expect(mockServerManager.findConfig).toHaveBeenCalledWith(
			"unknown",
			"/tmp/repo",
			"/tmp/repo/lib/example.ex"
		);
		expect(sendRequest).toHaveBeenCalledWith("textDocument/hover", {
			textDocument: { uri: "file:///tmp/repo/lib/example.ex" },
			position: { line: 0, character: 0 },
		});
		expect(result).toEqual({ result: { ok: true } });
	});

	test("lsp:notification resolves config by file extension when languageId is unknown", () => {
		const sendNotification = mock(() => {});
		mockServerManager.findConfig.mockImplementation(
			(languageId: string, _repoPath: string, filePath?: string) => {
				if (languageId === "unknown" && filePath === "/tmp/repo/lib/example.ex") {
					return {
						id: "elixir",
						command: "elixir-ls",
						args: [],
						languages: ["elixir"],
						fileExtensions: [".ex"],
					};
				}

				return undefined;
			}
		);
		mockServerManager.getConnection.mockImplementation(() => ({ sendNotification }));

		setupLspIPC({ webContents: { send: () => {} } } as never);
		const handler = eventHandlers.get("lsp:notification");
		expect(handler).toBeDefined();

		handler?.(
			{},
			{
				languageId: "unknown",
				repoPath: "/tmp/repo",
				method: "textDocument/didOpen",
				params: {
					textDocument: {
						uri: "file:///tmp/repo/lib/example.ex",
						languageId: "unknown",
						version: 1,
						text: "hello",
					},
				},
			}
		);

		expect(mockServerManager.findConfig).toHaveBeenCalledWith(
			"unknown",
			"/tmp/repo",
			"/tmp/repo/lib/example.ex"
		);
		expect(sendNotification).toHaveBeenCalledWith("textDocument/didOpen", {
			textDocument: {
				uri: "file:///tmp/repo/lib/example.ex",
				languageId: "unknown",
				version: 1,
				text: "hello",
			},
		});
		expect(mockServerManager.trackDocument).toHaveBeenCalledWith(
			"elixir",
			"/tmp/repo",
			"file:///tmp/repo/lib/example.ex"
		);
	});
});
