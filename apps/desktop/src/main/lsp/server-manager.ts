import { type ChildProcess, spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import {
	type InitializeParams,
	type MessageConnection,
	createMessageConnection,
} from "vscode-languageserver-protocol/node.js";
import {
	DEFAULT_SERVER_CONFIGS,
	buildRegistry,
	loadRepoConfig,
	loadUserConfig,
	resolveSupport,
} from "./registry";

export interface ServerConfig {
	id: string;
	command: string;
	args: string[];
	languages: string[];
	fileExtensions: string[];
}

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
	private unavailableServers = new Set<string>();
	private static MAX_RESTARTS = 3;
	private mainWindow: BrowserWindow | null = null;

	setMainWindow(window: BrowserWindow): void {
		this.mainWindow = window;
	}

	private serverKey(configId: string, repoPath: string): string {
		return `${configId}:${repoPath}`;
	}

	private unavailableServerKey(configId: string, repoPath: string): string {
		return this.serverKey(configId, repoPath);
	}

	private getRegistry(repoPath?: string) {
		const normalizedRepoPath = repoPath?.trim();
		return buildRegistry({
			defaults: DEFAULT_SERVER_CONFIGS,
			user: loadUserConfig(),
			repo: normalizedRepoPath ? loadRepoConfig(normalizedRepoPath) : [],
			env: {
				...process.env,
				workspaceFolder: normalizedRepoPath,
			},
		});
	}

	private toServerConfig(config: {
		id: string;
		command: string;
		args: string[];
		languages: string[];
		fileExtensions: string[];
	}): ServerConfig {
		return {
			id: config.id,
			command: config.command,
			args: config.args,
			languages: config.languages,
			fileExtensions: config.fileExtensions,
		};
	}

	private findConfigById(configId: string, repoPath: string): ServerConfig | undefined {
		const config = this.getRegistry(repoPath).byId.get(configId);
		if (!config || config.disabled) {
			return undefined;
		}

		return this.toServerConfig(config);
	}

	getResolvedConfig(repoPath: string, languageId: string, filePath?: string): ServerConfig | null {
		const registry = this.getRegistry(repoPath);
		const support = resolveSupport(registry, {
			languageId,
			filePath: filePath ?? "",
		});

		if (!support.supported) {
			return null;
		}

		return this.toServerConfig(support.config);
	}

	findConfig(languageId: string, repoPath: string, filePath?: string): ServerConfig | undefined {
		return this.getResolvedConfig(repoPath, languageId, filePath) ?? undefined;
	}

	findConfigByExtension(filePath: string, repoPath?: string): ServerConfig | undefined {
		if (!repoPath) {
			return undefined;
		}

		const support = resolveSupport(this.getRegistry(repoPath), {
			languageId: "",
			filePath,
		});
		return support.supported ? this.toServerConfig(support.config) : undefined;
	}

	async getOrCreate(configId: string, repoPath: string): Promise<MessageConnection | null> {
		const key = this.serverKey(configId, repoPath);
		const existing = this.servers.get(key);
		if (existing?.initialized) return existing.connection;
		if (existing) return null; // Still initializing

		return this.startServer(configId, repoPath);
	}

	private async startServer(configId: string, repoPath: string): Promise<MessageConnection | null> {
		const config = this.findConfigById(configId, repoPath);
		if (!config) return null;

		const key = this.serverKey(configId, repoPath);
		const unavailableKey = this.unavailableServerKey(configId, repoPath);

		// Check if this server has permanently failed (command not found)
		if (this.unavailableServers.has(unavailableKey)) return null;

		let childProcess: ChildProcess;
		try {
			childProcess = spawn(config.command, config.args, {
				cwd: repoPath,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch {
			console.error(`[LSP] Failed to spawn ${config.command}. Is it installed?`);
			this.unavailableServers.add(unavailableKey);
			return null;
		}

		if (!childProcess.stdin || !childProcess.stdout) {
			console.error(`[LSP] No stdio streams for ${config.command}`);
			childProcess.kill();
			return null;
		}

		// Wait for the process to confirm it's actually running (not ENOENT)
		const spawnResult = await new Promise<boolean>((resolve) => {
			const onSpawn = () => {
				cleanup();
				resolve(true);
			};
			const onError = (err: Error) => {
				cleanup();
				console.error(`[LSP] Failed to spawn ${config.command}: ${err.message}`);
				this.unavailableServers.add(unavailableKey);
				resolve(false);
			};
			const cleanup = () => {
				childProcess.removeListener("spawn", onSpawn);
				childProcess.removeListener("error", onError);
			};
			childProcess.on("spawn", onSpawn);
			childProcess.on("error", onError);
		});

		if (!spawnResult) return null;

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

		childProcess.on("error", () => {
			// Handle post-spawn errors (e.g. process killed externally).
			// The exit handler below takes care of cleanup and crash recovery.
		});

		childProcess.on("exit", (code) => {
			console.warn(`[LSP] ${config.command} exited with code ${code}`);
			const shuttingDown = instance.shuttingDown;
			const crashedDocs = shuttingDown ? new Set<string>() : new Set(instance.openDocuments);
			this.servers.delete(key);
			connection.dispose();
			if (!shuttingDown) {
				this.handleCrash(configId, repoPath, crashedDocs);
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
				// Skip the ipc-safety walker on this path: params arrive from
				// vscode-jsonrpc's JSON parser, so they're plain data by construction.
				// Instrumenting publishDiagnostics would also fill the 5 MB log
				// budget within hours of typing — it fires per keystroke.
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
			// Mark as shutting down to prevent crash recovery for init failures
			instance.shuttingDown = true;
			connection.dispose();
			childProcess.kill();
			this.servers.delete(key);
			return null;
		}
	}

	private handleCrash(configId: string, repoPath: string, openDocuments: Set<string>): void {
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
			const connection = await this.startServer(configId, repoPath);
			// Notify the renderer to re-send didOpen for previously open documents
			if (connection && openDocuments.size > 0) {
				this.mainWindow?.webContents.send("lsp:server-restarted", configId, repoPath, [
					...openDocuments,
				]);
			}
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
