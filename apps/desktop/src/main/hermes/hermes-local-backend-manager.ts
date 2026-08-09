import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { ensureManagedHermesMcpAccess } from "../services/external-managers";
import {
	HERMES_PROFILE_ID_PATTERN,
	buildHermesBackendLaunch,
	normalizeManagedHermesProfileId,
	resolveHermesExecutable,
	resolveHermesHomeRoot,
} from "./hermes-cli";
import { discoverHermesDashboardToken } from "./hermes-dashboard-token";
import { HermesRestClient } from "./hermes-rest-client";
import { HermesRuntimeClient } from "./hermes-runtime-client";

const DEFAULT_PORT_ANNOUNCE_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const READY_PATTERN = /^HERMES_(?:BACKEND|DASHBOARD)_READY port=(\d{1,5})\r?$/;

interface HermesBackendOutputStream {
	on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
	off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface HermesBackendChild {
	readonly stdout: HermesBackendOutputStream;
	readonly stderr: HermesBackendOutputStream;
	readonly pid?: number;
	readonly exitCode?: number | null;
	readonly killed?: boolean;
	on(
		event: "error" | "exit",
		listener:
			| ((error: Error) => void)
			| ((code: number | null, signal: NodeJS.Signals | null) => void)
	): unknown;
	off(
		event: "error" | "exit",
		listener:
			| ((error: Error) => void)
			| ((code: number | null, signal: NodeJS.Signals | null) => void)
	): unknown;
	kill(signal?: NodeJS.Signals): boolean;
}

export interface HermesLocalBackendRuntime {
	baseUrl: string;
	profileId: string;
	token: string;
	managerId?: string;
}

export interface HermesLocalBackendInvalidation {
	baseUrl: string;
	profileId: string;
}

export interface HermesLocalBackendManagerLike {
	ensure(profileId: string): Promise<HermesLocalBackendRuntime>;
	subscribeRuntimeInvalidated(
		listener: (event: HermesLocalBackendInvalidation) => void
	): () => void;
	shutdown(): void;
}

interface SpawnOptions {
	shell: false;
	stdio: ["ignore", "pipe", "pipe"];
	env: NodeJS.ProcessEnv;
}

export interface HermesLocalBackendManagerOptions {
	executableResolver?: () => string | null;
	hermesHomeResolver?: (profileId: string) => string;
	tokenFactory?: () => string;
	spawnProcess?: (executable: string, argv: string[], options: SpawnOptions) => HermesBackendChild;
	dashboardTokenResolver?: (baseUrl: string, fallbackToken: string) => Promise<string>;
	runtimeVerifier?: (runtime: HermesLocalBackendRuntime) => Promise<void>;
	beforeStart?: (input: { profileId: string; hermesHome: string }) =>
		| { managerId: string }
		| undefined;
	portAnnounceTimeoutMs?: number;
	maxOutputBytes?: number;
}

interface BackendEntry {
	profileId: string;
	child: HermesBackendChild;
	promise: Promise<HermesLocalBackendRuntime>;
	runtime: HermesLocalBackendRuntime | null;
	spawnToken: string;
	managerId: string | null;
	stdoutBuffer: string;
	stderrTail: string;
	outputBytes: number;
	ready: boolean;
	stopping: boolean;
	settled: boolean;
	timer: ReturnType<typeof setTimeout> | null;
	rejectStart: ((error: Error) => void) | null;
	resolvePort: ((port: number) => void) | null;
	onStdout: (chunk: Buffer | string) => void;
	onStderr: (chunk: Buffer | string) => void;
	onError: (error: Error) => void;
	onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

function defaultSpawnProcess(
	executable: string,
	argv: string[],
	options: SpawnOptions
): HermesBackendChild {
	return spawn(executable, argv, options) as unknown as HermesBackendChild;
}

function sanitizeDiagnostic(value: string, spawnToken: string): string {
	const redacted = value
		.replaceAll(spawnToken, "[redacted]")
		.replace(/([?&](?:token|ticket)=)[^\s&]+/gi, "$1[redacted]")
		.replace(/\b(token|secret|authorization)(\s*[:=]\s*)[^\s]+/gi, "$1$2[redacted]");
	return Array.from(redacted)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code >= 32 || character === "\n" || character === "\r" || character === "\t";
		})
		.join("")
		.slice(-MAX_DIAGNOSTIC_BYTES);
}

async function verifyLocalRuntime(runtime: HermesLocalBackendRuntime): Promise<void> {
	const rest = new HermesRestClient(runtime);
	await rest.status();
	const websocket = new HermesRuntimeClient({ reconnect: false });
	try {
		await websocket.connect({
			baseUrl: runtime.baseUrl,
			authMode: "token",
			token: runtime.token,
		});
	} finally {
		websocket.disconnect();
	}
}

export class HermesLocalBackendManager implements HermesLocalBackendManagerLike {
	private readonly entries = new Map<string, BackendEntry>();
	private readonly invalidationSubscribers = new Set<
		(event: HermesLocalBackendInvalidation) => void
	>();
	private readonly executableResolver: () => string | null;
	private readonly hermesHomeResolver: (profileId: string) => string;
	private readonly tokenFactory: () => string;
	private readonly spawnProcess: NonNullable<HermesLocalBackendManagerOptions["spawnProcess"]>;
	private readonly dashboardTokenResolver: (
		baseUrl: string,
		fallbackToken: string
	) => Promise<string>;
	private readonly runtimeVerifier: (runtime: HermesLocalBackendRuntime) => Promise<void>;
	private readonly beforeStart: NonNullable<HermesLocalBackendManagerOptions["beforeStart"]>;
	private readonly portAnnounceTimeoutMs: number;
	private readonly maxOutputBytes: number;
	private closed = false;

	constructor(options: HermesLocalBackendManagerOptions = {}) {
		this.executableResolver = options.executableResolver ?? resolveHermesExecutable;
		this.hermesHomeResolver = options.hermesHomeResolver ?? (() => resolveHermesHomeRoot());
		this.tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
		this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
		this.dashboardTokenResolver =
			options.dashboardTokenResolver ??
			(async (baseUrl, fallbackToken) => {
				try {
					return await discoverHermesDashboardToken(baseUrl);
				} catch {
					// Stock `hermes serve` is intentionally headless. Match Desktop's adoption
					// path: use a served SPA token when one exists, otherwise retain the token
					// that main generated and injected into this exact owned child's environment.
					return fallbackToken;
				}
			});
		this.runtimeVerifier = options.runtimeVerifier ?? verifyLocalRuntime;
		this.beforeStart = options.beforeStart ?? (() => undefined);
		this.portAnnounceTimeoutMs = options.portAnnounceTimeoutMs ?? DEFAULT_PORT_ANNOUNCE_TIMEOUT_MS;
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
	}

	ensure(profileId: string): Promise<HermesLocalBackendRuntime> {
		if (this.closed) return Promise.reject(new Error("Stock Hermes manager is shut down"));
		if (!HERMES_PROFILE_ID_PATTERN.test(profileId)) {
			return Promise.reject(new Error("Hermes profile is invalid"));
		}
		const managedProfileId = normalizeManagedHermesProfileId(profileId);
		const existing = this.entries.get(managedProfileId);
		if (existing) return existing.promise;

		const executable = this.executableResolver();
		if (!executable) {
			return Promise.reject(
				new Error("Stock Hermes is unavailable. Install the stock Hermes launcher, then Retry.")
			);
		}
		const launch = buildHermesBackendLaunch(
			managedProfileId,
			this.hermesHomeResolver(managedProfileId)
		);
		let managerId: string | null = null;
		try {
			managerId =
				this.beforeStart({ profileId: managedProfileId, hermesHome: launch.hermesHome })
					?.managerId ?? null;
		} catch (error) {
			return Promise.reject(
				error instanceof Error ? error : new Error("Managed Hermes MCP setup failed. Retry.")
			);
		}
		const spawnToken = this.tokenFactory();
		let child: HermesBackendChild;
		try {
			const childEnv = Object.fromEntries(
				Object.entries(process.env).filter(([key]) => key !== "HERMES_DESKTOP")
			);
			childEnv["HERMES_HOME"] = launch.hermesHome;
			childEnv["HERMES_DASHBOARD_SESSION_TOKEN"] = spawnToken;
			child = this.spawnProcess(executable, launch.argv, {
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: childEnv,
			});
		} catch {
			return Promise.reject(new Error("Stock Hermes failed to start. Retry."));
		}

		const entry = this.createEntry(managedProfileId, child, spawnToken, managerId);
		entry.promise = this.startEntry(entry);
		this.entries.set(managedProfileId, entry);
		return entry.promise;
	}

	subscribeRuntimeInvalidated(
		listener: (event: HermesLocalBackendInvalidation) => void
	): () => void {
		if (this.closed) return () => undefined;
		this.invalidationSubscribers.add(listener);
		return () => this.invalidationSubscribers.delete(listener);
	}

	describeOwnedBackends(): Array<{
		profileId: string;
		pid: number | null;
		status: "starting" | "ready";
	}> {
		return [...this.entries.values()].map((entry) => ({
			profileId: entry.profileId,
			pid: Number.isInteger(entry.child.pid) ? (entry.child.pid ?? null) : null,
			status: entry.ready ? "ready" : "starting",
		}));
	}

	shutdown(): void {
		if (this.closed) return;
		this.closed = true;
		this.invalidationSubscribers.clear();
		const owned = [...this.entries.values()];
		this.entries.clear();
		for (const entry of owned) this.stopEntry(entry);
	}

	private createEntry(
		profileId: string,
		child: HermesBackendChild,
		spawnToken: string,
		managerId: string | null
	): BackendEntry {
		const entry: BackendEntry = {
			profileId,
			child,
			promise: Promise.resolve(null as unknown as HermesLocalBackendRuntime),
			runtime: null,
			spawnToken,
			managerId,
			stdoutBuffer: "",
			stderrTail: "",
			outputBytes: 0,
			ready: false,
			stopping: false,
			settled: false,
			timer: null,
			rejectStart: null,
			resolvePort: null,
			onStdout: (_chunk: Buffer | string) => undefined,
			onStderr: (_chunk: Buffer | string) => undefined,
			onError: (_error: Error) => undefined,
			onExit: (_code: number | null, _signal: NodeJS.Signals | null) => undefined,
		};
		entry.onStdout = (chunk) => this.onOutput(entry, chunk, true);
		entry.onStderr = (chunk) => this.onOutput(entry, chunk, false);
		entry.onError = () =>
			this.handleEntryTermination(entry, new Error("Stock Hermes process failed"));
		entry.onExit = (code, signal) =>
			this.handleEntryTermination(
				entry,
				new Error(`Stock Hermes exited before readiness (${signal ?? code ?? "unknown"})`)
			);
		child.stdout.on("data", entry.onStdout);
		child.stderr.on("data", entry.onStderr);
		child.on("error", entry.onError);
		child.on("exit", entry.onExit);
		return entry;
	}

	private async startEntry(entry: BackendEntry): Promise<HermesLocalBackendRuntime> {
		try {
			const port = await this.waitForPort(entry);
			const baseUrl = `http://127.0.0.1:${port}`;
			const token = await this.raceStartFailure(
				entry,
				this.dashboardTokenResolver(baseUrl, entry.spawnToken)
			);
			const runtime = {
				baseUrl,
				profileId: entry.profileId,
				token,
				...(entry.managerId ? { managerId: entry.managerId } : {}),
			};
			await this.raceStartFailure(entry, this.runtimeVerifier(runtime));
			entry.runtime = runtime;
			entry.ready = true;
			entry.settled = true;
			entry.rejectStart = null;
			return runtime;
		} catch {
			this.removeEntry(entry);
			this.stopEntry(entry);
			throw new Error("Stock Hermes failed to start. Retry.");
		}
	}

	private waitForPort(entry: BackendEntry): Promise<number> {
		return new Promise<number>((resolve, reject) => {
			entry.resolvePort = resolve;
			entry.rejectStart = reject;
			entry.timer = setTimeout(
				() => this.failEntry(entry, new Error("Stock Hermes readiness announcement timed out")),
				this.portAnnounceTimeoutMs
			);
			entry.timer.unref?.();
		});
	}

	private raceStartFailure<T>(entry: BackendEntry, operation: Promise<T>): Promise<T> {
		if (entry.child.exitCode !== null && entry.child.exitCode !== undefined) {
			return Promise.reject(new Error("Stock Hermes exited during startup verification"));
		}
		const failure = new Promise<never>((_resolve, reject) => {
			entry.rejectStart = reject;
		});
		return Promise.race([operation, failure]);
	}

	private onOutput(entry: BackendEntry, chunk: Buffer | string, stdout: boolean): void {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		entry.outputBytes += bytes.byteLength;
		if (entry.outputBytes > this.maxOutputBytes && !entry.ready) {
			this.failEntry(entry, new Error("Stock Hermes startup output exceeded its bound"));
			return;
		}
		const text = bytes.toString("utf8");
		if (!stdout) {
			entry.stderrTail = sanitizeDiagnostic(entry.stderrTail + text, entry.spawnToken);
			return;
		}
		if (entry.ready || !entry.resolvePort) return;
		entry.stdoutBuffer += text;
		let newline = entry.stdoutBuffer.indexOf("\n");
		while (newline >= 0) {
			const line = entry.stdoutBuffer.slice(0, newline);
			entry.stdoutBuffer = entry.stdoutBuffer.slice(newline + 1);
			const match = READY_PATTERN.exec(line);
			if (match?.[1]) {
				const port = Number(match[1]);
				if (Number.isInteger(port) && port > 0 && port <= 65_535) {
					if (entry.timer) clearTimeout(entry.timer);
					entry.timer = null;
					const resolvePort = entry.resolvePort;
					entry.resolvePort = null;
					resolvePort(port);
					return;
				}
			}
			newline = entry.stdoutBuffer.indexOf("\n");
		}
	}

	private failEntry(entry: BackendEntry, error: Error): void {
		if (entry.ready || entry.settled) return;
		entry.settled = true;
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = null;
		entry.rejectStart?.(error);
		entry.rejectStart = null;
	}

	private removeEntry(entry: BackendEntry): void {
		if (this.entries.get(entry.profileId) === entry) this.entries.delete(entry.profileId);
	}

	private handleEntryTermination(entry: BackendEntry, startupError: Error): void {
		if (entry.stopping) return;
		const invalidation =
			entry.ready && entry.runtime && !this.closed
				? { profileId: entry.profileId, baseUrl: entry.runtime.baseUrl }
				: null;
		this.removeEntry(entry);
		if (!entry.ready) this.failEntry(entry, startupError);
		this.stopEntry(entry);
		if (!invalidation) return;
		for (const subscriber of this.invalidationSubscribers) {
			try {
				subscriber(invalidation);
			} catch {
				// A lifecycle observer cannot interfere with owned-child cleanup.
			}
		}
	}

	private stopEntry(entry: BackendEntry): void {
		if (entry.stopping) return;
		entry.stopping = true;
		if (entry.timer) clearTimeout(entry.timer);
		entry.timer = null;
		entry.child.stdout.off("data", entry.onStdout);
		entry.child.stderr.off("data", entry.onStderr);
		entry.child.off("error", entry.onError);
		entry.child.off("exit", entry.onExit);
		if (entry.child.exitCode === null || entry.child.exitCode === undefined) {
			try {
				entry.child.kill("SIGTERM");
			} catch {
				// The owned child may have exited between the liveness check and signal.
			}
		}
	}
}

export const hermesLocalBackendManager = new HermesLocalBackendManager({
	beforeStart: ({ hermesHome }) =>
		ensureManagedHermesMcpAccess({ configPath: join(hermesHome, "config.yaml") }),
});
