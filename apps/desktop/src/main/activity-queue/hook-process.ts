import { spawn } from "node:child_process";
import { QUEUE_HOOK_OUTPUT_BYTES, QUEUE_HOOK_TIMEOUT_MS } from "../../shared/queue-hooks";

export type QueueHookRunResult = { ok: true; stdout: string } | { ok: false; error: string };

/** Only the explicitly trusted config command reaches the shell. Output is never evaluated. */
export function runQueueHook(
	command: string,
	cwd: string,
	signal?: AbortSignal,
	limits: { timeoutMs?: number; outputBytes?: number } = {}
): Promise<QueueHookRunResult> {
	if (process.platform === "win32")
		return Promise.resolve({ ok: false, error: "Project hooks are not supported on Windows yet." });
	if (signal?.aborted) return Promise.resolve({ ok: false, error: "Hook run cancelled." });
	return new Promise((resolve) => {
		const child = spawn("/bin/sh", ["-c", command], {
			cwd,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let error: string | null = null;
		let output = Buffer.alloc(0);
		let stderrBytes = 0;
		let totalBytes = 0;
		let finished = false;
		const cap = Math.min(limits.outputBytes ?? QUEUE_HOOK_OUTPUT_BYTES, QUEUE_HOOK_OUTPUT_BYTES);
		const kill = () => {
			if (child.pid) {
				try {
					process.kill(-child.pid, "SIGKILL");
				} catch {
					/* Already gone. */
				}
			}
		};
		const fail = (message: string) => {
			error ??= message;
			kill();
		};
		const abort = () => fail("Hook run cancelled.");
		const timer = setTimeout(
			() => fail("Hook exceeded its time limit."),
			Math.min(limits.timeoutMs ?? QUEUE_HOOK_TIMEOUT_MS, QUEUE_HOOK_TIMEOUT_MS)
		);
		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			kill(); // Also reap background descendants after an otherwise successful shell exit.
			try {
				resolve(
					error
						? { ok: false, error }
						: { ok: true, stdout: new TextDecoder("utf-8", { fatal: true }).decode(output) }
				);
			} catch {
				resolve({ ok: false, error: "Hook returned invalid text." });
			}
		};
		signal?.addEventListener("abort", abort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			totalBytes += chunk.length;
			if (output.length + chunk.length > cap || totalBytes > cap)
				fail("Hook exceeded its output limit.");
			else output = Buffer.concat([output, chunk]);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.length;
			totalBytes += chunk.length;
			if (stderrBytes > cap || totalBytes > cap) fail("Hook exceeded its error output limit.");
		});
		child.on("error", () => {
			error = "Hook could not be started.";
			finish();
		});
		child.on("exit", (code, termination) => {
			if (code !== 0 || termination) error ??= "Hook failed. Previous results were retained.";
			kill();
		});
		child.on("close", finish);
	});
}
