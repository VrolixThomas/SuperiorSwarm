import { type ChildProcess, execSync, spawn } from "node:child_process";
import { constants, accessSync, existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import {
	type InitializeParams,
	type MessageConnection,
	createMessageConnection,
} from "vscode-languageserver-protocol/node.js";
import type { LanguageServerConfig } from "../../shared/lsp-schema";
import type { LspHealthEntry } from "../../shared/types";
import {
	DEFAULT_SERVER_CONFIGS,
	buildRegistry,
	loadRepoConfigCached,
	loadUserConfigCached,
	resolveSupport,
} from "./registry";
import { getRepoTrust } from "./trust";

export type LspSupportResult =
	| {
			supported: true;
			reason: "language" | "extension";
			config: LanguageServerConfig;
	  }
	| {
			supported: false;
			reason: "unconfigured" | "missing-binary" | "untrusted-repo";
			config?: LanguageServerConfig;
	  };

interface ServerInstance {
	config: LanguageServerConfig;
	connection: MessageConnection;
	process: ChildProcess;
	rootUri: string;
	initialized: boolean;
	shuttingDown: boolean;
	openDocuments: Set<string>;
}

/**
 * On macOS/Linux, Electron launched from Finder inherits a minimal PATH
 * that doesn't include user-installed tools (npm globals, brew, dotnet, etc.).
 * Resolve the user's login-shell PATH once and cache it.
 */
let cachedShellPath: string | null = null;

export function _resetShellPathCacheForTests(): void {
	cachedShellPath = null;
	cachedDotnetRoot = undefined;
}

function resolveShellPath(): string {
	if (cachedShellPath !== null) return cachedShellPath;

	if (process.platform === "win32") {
		cachedShellPath = process.env["PATH"] ?? "";
		return cachedShellPath;
	}

	const shell = resolveLoginShell();
	try {
		const raw = execSync(`${shell} -ilc 'printf "%s" "$PATH"'`, {
			encoding: "utf-8",
			timeout: 5000,
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (raw) {
			cachedShellPath = raw;
			return cachedShellPath;
		}
	} catch {
		// Fall through to process.env
	}

	cachedShellPath = process.env["PATH"] ?? "";
	return cachedShellPath;
}

function resolveLoginShell(): string {
	const candidates = [process.env["SHELL"], "/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const sh of candidates) {
		if (sh && existsSync(sh)) return sh;
	}
	return "/bin/sh";
}

function expandTildes(pathStr: string): string {
	const home = homedir();
	return pathStr
		.split(delimiter)
		.map((p) => (p.startsWith("~/") ? join(home, p.slice(2)) : p))
		.join(delimiter);
}

/**
 * Resolve DOTNET_ROOT from the `dotnet` binary on PATH.
 * Homebrew installs place the SDK under a `libexec` sibling of the bin dir;
 * standard installs keep `shared/` next to the binary.  Without DOTNET_ROOT,
 * .NET global tools (e.g. csharp-ls) may find an older system-level runtime
 * that lacks the SDK version they need.
 */
let cachedDotnetRoot: string | null | undefined;

function resolveDotnetRoot(): string | undefined {
	if (cachedDotnetRoot !== undefined) return cachedDotnetRoot ?? undefined;

	if (process.env["DOTNET_ROOT"]) {
		cachedDotnetRoot = process.env["DOTNET_ROOT"];
		return cachedDotnetRoot;
	}

	const home = homedir();
	const pathEntries = resolveShellPath()
		.split(delimiter)
		.filter(Boolean)
		.map((p) => (p.startsWith("~/") ? join(home, p.slice(2)) : p));

	for (const entry of pathEntries) {
		const candidate = join(entry, "dotnet");
		if (!existsSync(candidate)) continue;

		try {
			const real = realpathSync(candidate);
			const binDir = dirname(real);
			const installDir = dirname(binDir);

			// Homebrew pattern: .../libexec/shared exists alongside bin/
			const libexec = join(installDir, "libexec");
			if (existsSync(join(libexec, "shared"))) {
				cachedDotnetRoot = libexec;
				return cachedDotnetRoot;
			}

			// Standard pattern: dotnet binary sits next to shared/
			if (existsSync(join(binDir, "shared"))) {
				cachedDotnetRoot = binDir;
				return cachedDotnetRoot;
			}
		} catch {
			continue;
		}
	}

	cachedDotnetRoot = null;
	return undefined;
}

function buildServerEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, PATH: expandTildes(resolveShellPath()) };
	if (!env["DOTNET_ROOT"]) {
		const dotnetRoot = resolveDotnetRoot();
		if (dotnetRoot) env["DOTNET_ROOT"] = dotnetRoot;
	}
	return env;
}

export class ServerManager {
	private servers = new Map<string, ServerInstance>();
	private initFailures = new Map<string, number>();
	private crashCounts = new Map<string, number>();
	private restartTimers = new Set<ReturnType<typeof setTimeout>>();
	private unavailableServers = new Set<string>();
	private serverLastErrors = new Map<string, string>();
	private serverLastStartupErrors = new Map<string, string>();
	private executableCache = new Map<string, { available: boolean; expiresAt: number }>();
	private static MAX_RESTARTS = 3;
	private static EXECUTABLE_CACHE_TTL_MS = 10_000;
	private mainWindow: BrowserWindow | null = null;

	setMainWindow(window: BrowserWindow): void {
		this.mainWindow = window;
	}

	private serverKey(configId: string, repoPath: string): string {
		return `${configId}:${repoPath}`;
	}

	private canExecute(path: string): boolean {
		try {
			accessSync(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}

	private isWindowsPlatform(): boolean {
		return process.platform === "win32";
	}

	private getWindowsPathExts(command: string): string[] {
		const hasExplicitExtension = extname(basename(command)).length > 0;
		if (hasExplicitExtension) {
			return [""];
		}

		const pathExt = process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD";
		const extensions = pathExt
			.split(";")
			.map((ext) => ext.trim())
			.filter(Boolean)
			.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));

		if (extensions.length === 0) {
			return [""];
		}

		return ["", ...extensions];
	}

	private isServerExecutableAvailable(config: LanguageServerConfig, repoPath: string): boolean {
		const command = config.command.trim();
		if (!command) return false;

		const cacheKey = `${command}\u0000${repoPath}`;
		const cached = this.executableCache.get(cacheKey);
		const now = Date.now();
		if (cached && cached.expiresAt > now) {
			this.syncAvailabilityState(config, repoPath, cached.available);
			return cached.available;
		}

		const available = this.resolveExecutableAvailability(command, repoPath);
		this.executableCache.set(cacheKey, {
			available,
			expiresAt: now + ServerManager.EXECUTABLE_CACHE_TTL_MS,
		});
		this.syncAvailabilityState(config, repoPath, available);
		return available;
	}

	private syncAvailabilityState(config: LanguageServerConfig, repoPath: string, available: boolean): void {
		const key = this.serverKey(config.id, repoPath);
		if (available) {
			this.unavailableServers.delete(key);
			this.serverLastErrors.delete(key);
		} else {
			this.unavailableServers.add(key);
			if (!this.serverLastErrors.has(key)) {
				this.serverLastErrors.set(key, `Executable not found: ${config.command}`);
			}
		}
	}

	private resolveExecutableAvailability(trimmedCommand: string, repoPath: string): boolean {
		if (
			isAbsolute(trimmedCommand) ||
			trimmedCommand.startsWith(".") ||
			trimmedCommand.includes("/") ||
			trimmedCommand.includes("\\")
		) {
			const resolvedPath = isAbsolute(trimmedCommand)
				? trimmedCommand
				: join(repoPath, trimmedCommand);
			if (this.canExecute(resolvedPath)) {
				return true;
			}

			if (!this.isWindowsPlatform()) {
				return false;
			}

			for (const extension of this.getWindowsPathExts(trimmedCommand)) {
				if (!extension) {
					continue;
				}

				if (this.canExecute(`${resolvedPath}${extension}`)) {
					return true;
				}
			}

			return false;
		}

		const home = homedir();
		const pathEntries = resolveShellPath()
			.split(delimiter)
			.filter(Boolean)
			.map((p) => (p.startsWith("~/") ? join(home, p.slice(2)) : p));
		const commandSuffixes = this.isWindowsPlatform()
			? this.getWindowsPathExts(trimmedCommand)
			: [""];
		for (const entry of pathEntries) {
			for (const suffix of commandSuffixes) {
				const candidate = join(entry, `${trimmedCommand}${suffix}`);
				if (this.canExecute(candidate)) {
					return true;
				}
			}
		}

		return false;
	}

	private getRegistry(repoPath?: string) {
		const normalizedRepoPath = repoPath?.trim();
		const repoConfig =
			normalizedRepoPath && getRepoTrust(normalizedRepoPath).trusted
				? loadRepoConfigCached(normalizedRepoPath)
				: [];
		return buildRegistry({
			defaults: DEFAULT_SERVER_CONFIGS,
			user: loadUserConfigCached(),
			repo: repoConfig,
			env: {
				...process.env,
				workspaceFolder: normalizedRepoPath,
			},
		});
	}

	private findConfigById(configId: string, repoPath: string): LanguageServerConfig | undefined {
		const config = this.getRegistry(repoPath).byId.get(configId);
		if (!config || config.disabled) {
			return undefined;
		}

		return config;
	}

	getResolvedConfig(
		repoPath: string,
		languageId: string,
		filePath?: string
	): LanguageServerConfig | null {
		const registry = this.getRegistry(repoPath);
		const support = resolveSupport(registry, {
			languageId,
			filePath: filePath ?? "",
		});

		if (!support.supported) {
			return null;
		}

		return support.config;
	}

	findConfig(
		languageId: string,
		repoPath: string,
		filePath?: string
	): LanguageServerConfig | undefined {
		return this.getResolvedConfig(repoPath, languageId, filePath) ?? undefined;
	}

	getSupport(repoPath: string, languageId: string, filePath: string): LspSupportResult {
		const registry = this.getRegistry(repoPath);
		const support = resolveSupport(registry, { languageId, filePath });

		if (support.supported) {
			if (!this.isServerExecutableAvailable(support.config, repoPath)) {
				return { supported: false, reason: "missing-binary", config: support.config };
			}
			return { supported: true, reason: support.reason, config: support.config };
		}

		// Shadow check: would an untrusted repo config have matched?
		const normalized = repoPath.trim();
		if (normalized && !getRepoTrust(normalized).trusted) {
			const shadowRegistry = buildRegistry({
				defaults: [],
				user: [],
				repo: loadRepoConfigCached(normalized),
				env: { ...process.env, workspaceFolder: normalized },
			});
			if (resolveSupport(shadowRegistry, { languageId, filePath }).supported) {
				return { supported: false, reason: "untrusted-repo" };
			}
		}

		return { supported: false, reason: support.reason };
	}

	getHealth(repoPath: string): LspHealthEntry[] {
		const registry = this.getRegistry(repoPath);
		const entries: LspHealthEntry[] = [];

		const searchedPath = resolveShellPath();

		for (const config of registry.byId.values()) {
			if (config.disabled) continue;

			const available = this.isServerExecutableAvailable(config, repoPath);
			const key = this.serverKey(config.id, repoPath);
			const activeInstance = this.servers.get(key);

			entries.push({
				id: config.id,
				command: config.command,
				available,
				lastError: this.serverLastErrors.get(key),
				lastStartupError: this.serverLastStartupErrors.get(key),
				activeSessions: activeInstance ? 1 : 0,
				activeSessionDocuments: activeInstance ? [...activeInstance.openDocuments] : [],
				searchedPath: available ? undefined : searchedPath,
			});
		}

		return entries;
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

		if (this.unavailableServers.has(key)) return null;

		const initFailures = this.initFailures.get(key) ?? 0;
		if (initFailures >= ServerManager.MAX_RESTARTS) return null;

		let childProcess: ChildProcess;
		try {
			childProcess = spawn(config.command, config.args, {
				cwd: repoPath,
				stdio: ["pipe", "pipe", "pipe"],
				env: buildServerEnv(),
			});
		} catch {
			console.error(`[LSP] Failed to spawn ${config.command}. Is it installed?`);
			this.unavailableServers.add(key);
			this.serverLastErrors.set(key, `Failed to spawn ${config.command}`);
			this.serverLastStartupErrors.set(key, `Failed to spawn ${config.command}`);
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
				this.unavailableServers.add(key);
				this.serverLastErrors.set(key, err.message);
				this.serverLastStartupErrors.set(key, err.message);
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

		this.unavailableServers.delete(key);
		this.serverLastErrors.delete(key);

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

		let stderrBuffer = "";
		childProcess.stderr?.on("data", (data: Buffer) => {
			const text = data.toString();
			console.error(`[LSP ${config.id}] ${text}`);
			stderrBuffer += text;
			if (stderrBuffer.length > 1024) {
				stderrBuffer = stderrBuffer.slice(-1024);
			}
		});

		childProcess.on("exit", (code) => {
			console.warn(`[LSP] ${config.command} exited with code ${code}`);
			if (code !== 0 && stderrBuffer.trim()) {
				this.serverLastStartupErrors.set(key, stderrBuffer.trim());
			}
			const shuttingDown = instance.shuttingDown;
			const crashedDocs = shuttingDown ? new Set<string>() : new Set(instance.openDocuments);
			this.servers.delete(key);
			connection.dispose();
			if (!shuttingDown) {
				this.handleCrash(configId, repoPath, crashedDocs);
			}
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
				initializationOptions: config.initializationOptions,
			};

			await connection.sendRequest("initialize", initParams);
			connection.sendNotification("initialized", {});
			instance.initialized = true;
			this.initFailures.delete(key);

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
			const message = err instanceof Error ? err.message : String(err);
			this.serverLastStartupErrors.set(key, message);
			// Track init failures to prevent crash loops from repeated getOrCreate calls
			const count = (this.initFailures.get(key) ?? 0) + 1;
			this.initFailures.set(key, count);
			if (count >= ServerManager.MAX_RESTARTS) {
				console.error(
					`[LSP] ${configId} failed to initialize ${count} times for ${repoPath}, giving up`
				);
			}
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
		const count = (this.crashCounts.get(key) ?? 0) + 1;
		this.crashCounts.set(key, count);

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
		this.crashCounts.delete(key);
	}

	async testServer(
		configId: string,
		repoPath: string
	): Promise<
		{ ok: true; capabilities: unknown; serverInfo: unknown } | { ok: false; error: string }
	> {
		const config = this.findConfigById(configId, repoPath);
		if (!config) {
			return { ok: false, error: `No config for "${configId}"` };
		}

		if (!this.isServerExecutableAvailable(config, repoPath)) {
			return { ok: false, error: `Binary "${config.command}" not found on PATH` };
		}

		let childProcess: ChildProcess;
		try {
			childProcess = spawn(config.command, config.args, {
				cwd: repoPath,
				stdio: ["pipe", "pipe", "pipe"],
				env: buildServerEnv(),
			});
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		}

		if (!childProcess.stdin || !childProcess.stdout) {
			try {
				childProcess.kill();
			} catch {}
			return { ok: false, error: "No stdio streams" };
		}

		const spawnResult = await new Promise<true | string>((resolve) => {
			const onSpawn = () => {
				cleanup();
				resolve(true);
			};
			const onError = (err: Error) => {
				cleanup();
				resolve(err.message);
			};
			const cleanup = () => {
				childProcess.removeListener("spawn", onSpawn);
				childProcess.removeListener("error", onError);
			};
			childProcess.on("spawn", onSpawn);
			childProcess.on("error", onError);
		});

		if (spawnResult !== true) {
			return { ok: false, error: spawnResult };
		}

		const connection = createMessageConnection(childProcess.stdout, childProcess.stdin);
		connection.listen();

		const initParams: InitializeParams = {
			processId: process.pid,
			capabilities: {},
			rootUri: pathToFileURL(repoPath).toString(),
			workspaceFolders: [
				{ uri: pathToFileURL(repoPath).toString(), name: repoPath.split("/").pop() ?? "test" },
			],
			initializationOptions: config.initializationOptions,
		};

		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		try {
			const initRaw = (await Promise.race([
				connection.sendRequest("initialize", initParams),
				new Promise((_, reject) => {
					timeoutHandle = setTimeout(
						() => reject(new Error("initialize timed out after 10s")),
						10_000
					);
				}),
			])) as { capabilities?: unknown; serverInfo?: unknown };

			connection.sendNotification("initialized", {});

			try {
				await connection.sendRequest("shutdown");
				connection.sendNotification("exit");
			} catch {}

			connection.dispose();
			try {
				childProcess.kill();
			} catch {}

			return {
				ok: true,
				capabilities: initRaw?.capabilities ?? {},
				serverInfo: initRaw?.serverInfo ?? null,
			};
		} catch (err) {
			connection.dispose();
			try {
				childProcess.kill();
			} catch {}
			return { ok: false, error: err instanceof Error ? err.message : String(err) };
		} finally {
			if (timeoutHandle) clearTimeout(timeoutHandle);
		}
	}

	clearAvailabilityCache(configId?: string, repoPath?: string): void {
		if (!configId && !repoPath) {
			this.executableCache.clear();
			this.unavailableServers.clear();
			this.serverLastErrors.clear();
			return;
		}

		// executableCache keys are `${command}\u0000${repoPath}` (see isServerExecutableAvailable).
		const repoSuffix = repoPath ? `\u0000${repoPath}` : null;
		const resolvedCommand = configId
			? (this.getRegistry(repoPath ?? "").byId.get(configId)?.command ?? null)
			: null;
		const commandPrefix = resolvedCommand ? `${resolvedCommand}\u0000` : null;
		if (!configId || commandPrefix) {
			for (const key of this.executableCache.keys()) {
				if (repoSuffix && !key.endsWith(repoSuffix)) continue;
				if (commandPrefix && !key.startsWith(commandPrefix)) continue;
				this.executableCache.delete(key);
			}
		}

		const idPrefix = configId ? `${configId}:` : null;
		const pathSuffix = repoPath ? `:${repoPath}` : null;
		const serverKeyMatches = (serverKey: string): boolean => {
			if (idPrefix && !serverKey.startsWith(idPrefix)) return false;
			if (pathSuffix && !serverKey.endsWith(pathSuffix)) return false;
			return true;
		};
		for (const key of this.unavailableServers) {
			if (serverKeyMatches(key)) this.unavailableServers.delete(key);
		}
		for (const key of this.serverLastErrors.keys()) {
			if (serverKeyMatches(key)) this.serverLastErrors.delete(key);
		}
	}

	async disposeAll(): Promise<void> {
		for (const timer of this.restartTimers) {
			clearTimeout(timer);
		}
		this.restartTimers.clear();
		const keys = [...this.servers.keys()];
		await Promise.all(keys.map((key) => this.shutdownServer(key)));
	}

	async evictServer(configId: string, repoPath?: string): Promise<void> {
		const matchingKeys: string[] = [];
		const suffix = repoPath ? `:${repoPath}` : null;
		for (const key of this.servers.keys()) {
			if (!key.startsWith(`${configId}:`)) continue;
			if (suffix && !key.endsWith(suffix)) continue;
			matchingKeys.push(key);
		}

		const idPrefixLen = `${configId}:`.length;
		const notifications: Array<{ repo: string; uris: string[] }> = [];
		for (const key of matchingKeys) {
			const instance = this.servers.get(key);
			if (instance && instance.openDocuments.size > 0) {
				notifications.push({
					repo: key.substring(idPrefixLen),
					uris: [...instance.openDocuments],
				});
			}
		}

		await Promise.all(matchingKeys.map((key) => this.shutdownServer(key)));

		// Also purge bookkeeping for the same key shape when no live instance
		// existed (e.g. a prior failure left entries behind).
		const idPrefix = `${configId}:`;
		const matchesKey = (key: string) =>
			key.startsWith(idPrefix) && (!suffix || key.endsWith(suffix));
		for (const key of this.unavailableServers) {
			if (matchesKey(key)) this.unavailableServers.delete(key);
		}
		for (const map of [
			this.serverLastErrors,
			this.serverLastStartupErrors,
			this.initFailures,
			this.crashCounts,
		]) {
			for (const key of map.keys()) {
				if (matchesKey(key)) map.delete(key);
			}
		}

		for (const { repo, uris } of notifications) {
			this.mainWindow?.webContents.send("lsp:server-restarted", configId, repo, uris);
		}
	}

	diffChangedIds(oldList: LanguageServerConfig[], newList: LanguageServerConfig[]): Set<string> {
		const changed = new Set<string>();
		const oldById = new Map(oldList.map((c) => [c.id, c]));
		const newById = new Map(newList.map((c) => [c.id, c]));

		for (const [id, oldCfg] of oldById) {
			const newCfg = newById.get(id);
			if (!newCfg) {
				changed.add(id);
				continue;
			}
			if (!configsEffectivelyEqual(oldCfg, newCfg)) {
				changed.add(id);
			}
		}
		for (const id of newById.keys()) {
			if (!oldById.has(id)) changed.add(id);
		}
		return changed;
	}

	getConnection(configId: string, repoPath: string): MessageConnection | null {
		const key = this.serverKey(configId, repoPath);
		const instance = this.servers.get(key);
		return instance?.initialized ? instance.connection : null;
	}
}

function configsEffectivelyEqual(a: LanguageServerConfig, b: LanguageServerConfig): boolean {
	if (a.command !== b.command) return false;
	if (a.disabled !== b.disabled) return false;
	if (!arraysEqual(a.args, b.args)) return false;
	if (
		JSON.stringify(a.initializationOptions ?? null) !==
		JSON.stringify(b.initializationOptions ?? null)
	) {
		return false;
	}
	return true;
}

function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export const serverManager = new ServerManager();
