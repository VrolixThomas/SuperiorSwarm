import { type ChildProcess, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import {
	type InitializeParams,
	type MessageConnection,
	createMessageConnection,
} from "vscode-languageserver-protocol/node";

export interface ServerConfig {
	id: string;
	command: string;
	args: string[];
	languages: string[];
	fileExtensions: string[];
}

export const SERVER_CONFIGS: ServerConfig[] = [
	{
		id: "typescript",
		command: "typescript-language-server",
		args: ["--stdio"],
		languages: ["typescript", "javascript", "typescriptreact", "javascriptreact"],
		fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
	},
	{
		id: "python",
		command: "pyright-langserver",
		args: ["--stdio"],
		languages: ["python"],
		fileExtensions: [".py"],
	},
];

interface ServerInstance {
	config: ServerConfig;
	connection: MessageConnection;
	process: ChildProcess;
	rootUri: string;
	initialized: boolean;
	shuttingDown: boolean;
	openDocuments: Set<string>;
}

export class ServerManager {
	private servers = new Map<string, ServerInstance>();
	private restartCounts = new Map<string, number>();
	private restartTimers = new Set<ReturnType<typeof setTimeout>>();
	private static MAX_RESTARTS = 3;
	private mainWindow: BrowserWindow | null = null;

	setMainWindow(window: BrowserWindow): void {
		this.mainWindow = window;
	}

	private serverKey(configId: string, repoPath: string): string {
		return `${configId}:${repoPath}`;
	}

	findConfig(languageId: string): ServerConfig | undefined {
		return SERVER_CONFIGS.find((c) => c.languages.includes(languageId));
	}

	findConfigByExtension(filePath: string): ServerConfig | undefined {
		const ext = `.${filePath.split(".").pop()?.toLowerCase() ?? ""}`;
		return SERVER_CONFIGS.find((c) => c.fileExtensions.includes(ext));
	}

	async getOrCreate(configId: string, repoPath: string): Promise<MessageConnection | null> {
		const key = this.serverKey(configId, repoPath);
		const existing = this.servers.get(key);
		if (existing?.initialized) return existing.connection;
		if (existing) return null; // Still initializing

		return this.startServer(configId, repoPath);
	}

	private async startServer(configId: string, repoPath: string): Promise<MessageConnection | null> {
		const config = SERVER_CONFIGS.find((c) => c.id === configId);
		if (!config) return null;

		const key = this.serverKey(configId, repoPath);

		let childProcess: ChildProcess;
		try {
			childProcess = spawn(config.command, config.args, {
				cwd: repoPath,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			console.error(`[LSP] Failed to spawn ${config.command}. Is it installed?`);
			return null;
		}

		if (!childProcess.stdin || !childProcess.stdout) {
			console.error(`[LSP] No stdio streams for ${config.command}`);
			childProcess.kill();
			return null;
		}

		const connection = createMessageConnection(childProcess.stdout, childProcess.stdin);

		const instance: ServerInstance = {
			config,
			connection,
			process: childProcess,
			rootUri: pathToFileURL(repoPath).toString(),
			initialized: false,
			shuttingDown: false,
			openDocuments: new Set(),
		};

		this.servers.set(key, instance);

		childProcess.on("exit", (code) => {
			console.warn(`[LSP] ${config.command} exited with code ${code}`);
			this.servers.delete(key);
			connection.dispose();
			if (!instance.shuttingDown) {
				this.handleCrash(configId, repoPath);
			}
		});

		childProcess.stderr?.on("data", (data: Buffer) => {
			console.error(`[LSP ${config.id}] ${data.toString()}`);
		});

		connection.listen();

		try {
			const initParams: InitializeParams = {
				processId: process.pid,
				capabilities: {
					textDocument: {
						completion: {
							completionItem: {
								snippetSupport: true,
								commitCharactersSupport: true,
								documentationFormat: ["markdown", "plaintext"],
							},
						},
						hover: {
							contentFormat: ["markdown", "plaintext"],
						},
						definition: {},
						references: {},
						publishDiagnostics: {
							relatedInformation: true,
						},
						synchronization: {
							didSave: true,
							willSave: false,
							willSaveWaitUntil: false,
						},
					},
					workspace: {
						workspaceFolders: true,
					},
				},
				rootUri: instance.rootUri,
				workspaceFolders: [
					{ uri: instance.rootUri, name: repoPath.split("/").pop() ?? "workspace" },
				],
			};

			await connection.sendRequest("initialize", initParams);
			connection.sendNotification("initialized", {});
			instance.initialized = true;

			connection.onNotification("textDocument/publishDiagnostics", (params) => {
				this.mainWindow?.webContents.send(
					"lsp:notification-from-server",
					config.id,
					"textDocument/publishDiagnostics",
					params
				);
			});

			return connection;
		} catch (err) {
			console.error(`[LSP] Failed to initialize ${config.command}:`, err);
			connection.dispose();
			childProcess.kill();
			this.servers.delete(key);
			return null;
		}
	}

	private handleCrash(configId: string, repoPath: string): void {
		const key = this.serverKey(configId, repoPath);
		const count = (this.restartCounts.get(key) ?? 0) + 1;
		this.restartCounts.set(key, count);

		if (count > ServerManager.MAX_RESTARTS) {
			console.error(`[LSP] ${configId} crashed ${count} times for ${repoPath}, giving up`);
			return;
		}

		const delay = Math.min(1000 * 2 ** (count - 1), 10000);
		console.log(`[LSP] Restarting ${configId} in ${delay}ms (attempt ${count})`);

		const timer = setTimeout(async () => {
			this.restartTimers.delete(timer);
			await this.startServer(configId, repoPath);
			// The renderer will need to re-send didOpen for previously tracked documents
		}, delay);
		this.restartTimers.add(timer);
	}

	trackDocument(configId: string, repoPath: string, uri: string): void {
		const key = this.serverKey(configId, repoPath);
		this.servers.get(key)?.openDocuments.add(uri);
	}

	untrackDocument(configId: string, repoPath: string, uri: string): void {
		const key = this.serverKey(configId, repoPath);
		const instance = this.servers.get(key);
		if (instance) {
			instance.openDocuments.delete(uri);
			// Shut down server if no more open documents
			if (instance.openDocuments.size === 0) {
				this.shutdownServer(key);
			}
		}
	}

	private async shutdownServer(key: string): Promise<void> {
		const instance = this.servers.get(key);
		if (!instance) return;

		instance.shuttingDown = true;
		try {
			await instance.connection.sendRequest("shutdown");
			instance.connection.sendNotification("exit");
		} catch {
			// Force kill if graceful shutdown fails
			instance.process.kill();
		}
		instance.connection.dispose();
		this.servers.delete(key);
	}

	async disposeAll(): Promise<void> {
		for (const timer of this.restartTimers) {
			clearTimeout(timer);
		}
		this.restartTimers.clear();
		const keys = [...this.servers.keys()];
		await Promise.all(keys.map((key) => this.shutdownServer(key)));
	}

	getConnection(configId: string, repoPath: string): MessageConnection | null {
		const key = this.serverKey(configId, repoPath);
		const instance = this.servers.get(key);
		return instance?.initialized ? instance.connection : null;
	}
}

export const serverManager = new ServerManager();
