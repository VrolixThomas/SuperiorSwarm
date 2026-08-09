import { spawn } from "node:child_process";
import { constants, accessSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { HermesSlackTarget } from "./hermes-origin-resolver";

interface HermesOutputStream {
	on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface HermesChildProcess {
	stdin: { end(value?: string | Uint8Array): void };
	stdout: HermesOutputStream;
	stderr: HermesOutputStream;
	on(event: "error", listener: (error: Error) => void): unknown;
	on(event: "close", listener: (code: number | null, signal: string | null) => void): unknown;
	kill(signal?: NodeJS.Signals): boolean;
}

export type HermesSendErrorCode =
	| "unavailable"
	| "invalid-content"
	| "invalid-target"
	| "timeout"
	| "cancelled"
	| "output-too-large"
	| "spawn-failed"
	| "process-failed"
	| "malformed-output"
	| "provider-error";

export class HermesSendError extends Error {
	constructor(
		message: string,
		readonly code: HermesSendErrorCode,
		readonly retryable: boolean
	) {
		super(message);
		this.name = "HermesSendError";
	}
}

export interface HermesSendServiceOptions {
	executableResolver?: () => string | null;
	hermesHomeResolver?: (profileId: string) => string;
	spawnProcess?: (
		executable: string,
		argv: string[],
		options: {
			shell: false;
			stdio: ["pipe", "pipe", "pipe"];
			env: NodeJS.ProcessEnv;
		}
	) => HermesChildProcess;
	timeoutMs?: number;
	maxOutputBytes?: number;
	maxContentBytes?: number;
}

function defaultExecutableResolver(): string | null {
	const candidates: string[] = [];
	const explicit = process.env["HERMES_EXECUTABLE"]?.trim();
	if (explicit) candidates.push(explicit);
	for (const directory of (process.env["PATH"] ?? "").split(delimiter)) {
		if (directory) candidates.push(join(directory, "hermes"));
	}
	candidates.push(join(homedir(), ".local", "bin", "hermes"));
	candidates.push(join(homedir(), ".hermes", "bin", "hermes"));
	for (const candidate of candidates) {
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue through approved executable candidates without invoking a shell.
		}
	}
	return null;
}

function defaultHermesHomeResolver(profileId: string): string {
	if (profileId === "default" || profileId === "custom") {
		return process.env["HERMES_HOME"]?.trim() || join(homedir(), ".hermes");
	}
	return join(homedir(), ".hermes", "profiles", profileId);
}

function defaultSpawnProcess(
	executable: string,
	argv: string[],
	options: { shell: false; stdio: ["pipe", "pipe", "pipe"]; env: NodeJS.ProcessEnv }
): HermesChildProcess {
	return spawn(executable, argv, options) as unknown as HermesChildProcess;
}

function validTarget(target: HermesSlackTarget): boolean {
	return (
		/^[CDG][A-Z0-9]{2,31}$/.test(target.channelId) && /^\d{1,16}\.\d{1,9}$/.test(target.threadId)
	);
}

function providerMessageId(value: unknown): string | null {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
	const payload = value as Record<string, unknown>;
	const result =
		payload["result"] !== null &&
		typeof payload["result"] === "object" &&
		!Array.isArray(payload["result"])
			? (payload["result"] as Record<string, unknown>)
			: null;
	for (const candidate of [
		payload["message_id"],
		payload["messageId"],
		payload["ts"],
		result?.["message_id"],
		result?.["messageId"],
		result?.["ts"],
	]) {
		if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 512) {
			return candidate;
		}
	}
	return null;
}

export class HermesSendService {
	private readonly executableResolver: () => string | null;
	private readonly hermesHomeResolver: (profileId: string) => string;
	private readonly spawnProcess: NonNullable<HermesSendServiceOptions["spawnProcess"]>;
	private readonly timeoutMs: number;
	private readonly maxOutputBytes: number;
	private readonly maxContentBytes: number;

	constructor(options: HermesSendServiceOptions = {}) {
		this.executableResolver = options.executableResolver ?? defaultExecutableResolver;
		this.hermesHomeResolver = options.hermesHomeResolver ?? defaultHermesHomeResolver;
		this.spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
		this.timeoutMs = options.timeoutMs ?? 30_000;
		this.maxOutputBytes = options.maxOutputBytes ?? 256 * 1024;
		this.maxContentBytes = options.maxContentBytes ?? 200_000;
	}

	isAvailable(): boolean {
		return this.executableResolver() !== null;
	}

	async send(input: {
		profileId: string;
		target: HermesSlackTarget;
		content: string;
		signal?: AbortSignal;
	}): Promise<{ providerMessageId: string | null }> {
		if (!input.content.trim() || Buffer.byteLength(input.content) > this.maxContentBytes) {
			throw new HermesSendError(
				"The Slack update content is empty or too large",
				"invalid-content",
				false
			);
		}
		if (
			!validTarget(input.target) ||
			!/^(?:default|custom|[a-z0-9][a-z0-9_-]{0,63})$/.test(input.profileId)
		) {
			throw new HermesSendError(
				"The resolved Slack destination is invalid",
				"invalid-target",
				false
			);
		}
		const executable = this.executableResolver();
		if (!executable) {
			throw new HermesSendError("The stock Hermes sender is unavailable", "unavailable", false);
		}
		const target = `slack:${input.target.channelId}:${input.target.threadId}`;
		const argv = ["-p", input.profileId, "send", "--to", target, "--json"];
		let child: HermesChildProcess;
		try {
			child = this.spawnProcess(executable, argv, {
				shell: false,
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					HERMES_HOME: this.hermesHomeResolver(input.profileId),
				},
			});
		} catch {
			throw new HermesSendError("The stock Hermes sender could not start", "spawn-failed", true);
		}

		return new Promise((resolve, reject) => {
			let settled = false;
			let outputBytes = 0;
			const stdout: Buffer[] = [];
			const finish = (
				result: { providerMessageId: string | null } | null,
				error?: HermesSendError
			) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				input.signal?.removeEventListener("abort", onAbort);
				if (error) reject(error);
				else if (result) resolve(result);
			};
			const stopWith = (error: HermesSendError) => {
				child.kill("SIGKILL");
				finish(null, error);
			};
			const onChunk = (chunk: Buffer | string, collect: boolean) => {
				if (settled) return;
				const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				outputBytes += bytes.length;
				if (outputBytes > this.maxOutputBytes) {
					stopWith(
						new HermesSendError(
							"The stock Hermes sender returned too much output",
							"output-too-large",
							true
						)
					);
					return;
				}
				if (collect) stdout.push(bytes);
			};
			const onAbort = () =>
				stopWith(new HermesSendError("Slack delivery was cancelled", "cancelled", true));
			const timer = setTimeout(
				() => stopWith(new HermesSendError("Slack delivery timed out", "timeout", true)),
				this.timeoutMs
			);
			timer.unref?.();
			input.signal?.addEventListener("abort", onAbort, { once: true });
			child.stdout.on("data", (chunk) => onChunk(chunk, true));
			child.stderr.on("data", (chunk) => onChunk(chunk, false));
			child.on("error", () => {
				finish(
					null,
					new HermesSendError("The stock Hermes sender failed to run", "spawn-failed", true)
				);
			});
			child.on("close", (code) => {
				if (settled) return;
				if (code !== 0) {
					finish(
						null,
						new HermesSendError(
							`The stock Hermes sender exited with code ${code ?? "unknown"}`,
							"process-failed",
							true
						)
					);
					return;
				}
				let payload: unknown;
				try {
					payload = JSON.parse(Buffer.concat(stdout).toString("utf8"));
				} catch {
					finish(
						null,
						new HermesSendError(
							"The stock Hermes sender returned malformed output",
							"malformed-output",
							true
						)
					);
					return;
				}
				const result = payload as Record<string, unknown>;
				if (!result || result["success"] !== true || result["error"]) {
					finish(
						null,
						new HermesSendError(
							"The stock Hermes sender reported a delivery failure",
							"provider-error",
							true
						)
					);
					return;
				}
				finish({ providerMessageId: providerMessageId(payload) });
			});
			try {
				child.stdin.end(input.content);
			} catch {
				finish(
					null,
					new HermesSendError("The stock Hermes sender rejected input", "spawn-failed", true)
				);
			}
		});
	}
}

export const hermesSendService = new HermesSendService();
