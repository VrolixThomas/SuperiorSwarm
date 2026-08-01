import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";

export type BoundedProcessFailureKind = "spawn" | "exit" | "timeout";

export class BoundedProcessError extends Error {
	constructor(
		message: string,
		readonly kind: BoundedProcessFailureKind,
		readonly stdout = "",
		readonly stderr = "",
		readonly exitCode: number | null = null,
		readonly signal: NodeJS.Signals | null = null
	) {
		super(message);
		this.name = "BoundedProcessError";
	}
}

export interface RunBoundedProcessOptions {
	timeoutMs: number;
	terminateGraceMs: number;
	description?: string;
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	captureStdout?: boolean;
	allowNonZeroExit?: boolean;
	outputLimit?: number;
	/** Test-only process injection. */
	spawnProcess?: typeof spawn;
}

export interface BoundedProcessResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

export function runBoundedProcess(
	command: string,
	args: readonly string[],
	options: RunBoundedProcessOptions
): Promise<BoundedProcessResult> {
	const description = options.description ?? [command, ...args].join(" ");
	const outputLimit = options.outputLimit ?? 16_384;
	const spawnProcess = options.spawnProcess ?? spawn;

	return new Promise((resolvePromise, reject) => {
		let child: ChildProcess;
		const spawnOptions: SpawnOptions = {
			cwd: options.cwd,
			env: options.env,
			windowsHide: true,
			stdio: ["ignore", options.captureStdout === false ? "ignore" : "pipe", "pipe"],
		};
		try {
			child = spawnProcess(command, [...args], spawnOptions);
		} catch (error) {
			reject(
				new BoundedProcessError(
					`${description} failed to start: ${error instanceof Error ? error.message : String(error)}`,
					"spawn"
				)
			);
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;
		let timedOut = false;
		const timers: ReturnType<typeof setTimeout>[] = [];
		const appendBounded = (current: string, chunk: unknown) =>
			`${current}${String(chunk)}`.slice(-outputLimit);
		const finish = (error?: Error, exitCode = 0) => {
			if (settled) return;
			settled = true;
			for (const timer of timers) clearTimeout(timer);
			if (error) reject(error);
			else resolvePromise({ stdout, stderr, exitCode });
		};
		const timeoutError = () =>
			new BoundedProcessError(
				`${description} timed out after ${options.timeoutMs}ms`,
				"timeout",
				stdout.trim(),
				stderr.trim()
			);

		child.stdout?.on("data", (chunk) => {
			stdout = appendBounded(stdout, chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = appendBounded(stderr, chunk);
		});
		child.once("error", (error) => {
			finish(
				new BoundedProcessError(
					`${description} failed to start: ${error.message}`,
					"spawn",
					stdout.trim(),
					stderr.trim()
				)
			);
		});
		child.once("exit", (code, signal) => {
			if (timedOut) {
				finish(timeoutError());
				return;
			}
			if (code === 0 || options.allowNonZeroExit) {
				finish(undefined, code ?? 0);
				return;
			}
			finish(
				new BoundedProcessError(
					`${description} failed (${code ?? signal ?? "unknown"}): ${stderr.trim()}`,
					"exit",
					stdout.trim(),
					stderr.trim(),
					code,
					signal
				)
			);
		});

		timers.push(
			setTimeout(
				() => {
					timedOut = true;
					try {
						child.kill("SIGTERM");
					} catch {
						// The hard deadline below still settles the process.
					}
				},
				Math.max(0, options.timeoutMs - options.terminateGraceMs)
			)
		);
		timers.push(
			setTimeout(() => {
				timedOut = true;
				try {
					child.kill("SIGKILL");
				} finally {
					finish(timeoutError());
				}
			}, options.timeoutMs)
		);
	});
}
