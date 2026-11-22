import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { ReviewFetchProgress } from "../../shared/review-fetch-progress";

export const REVIEW_FETCH_IDLE_TIMEOUT_MS = 120_000;
export const REVIEW_FETCH_MAX_DURATION_MS = 10 * 60_000;
const STDERR_LIMIT = 16 * 1024;
const LINE_LIMIT = 4096;

export class ReviewFetchProcessError extends Error {
	constructor(
		readonly reason: "cancelled" | "timeout" | "stalled" | "process",
		readonly exitCode: number | null = null,
		readonly signal: NodeJS.Signals | null = null,
		/** Whitelisted diagnostic categories only. Never raw stderr. */
		readonly stderr = "",
		readonly code?: string
	) {
		super(
			{
				cancelled: "Review fetch cancelled",
				timeout: "Review fetch exceeded its overall time limit",
				stalled: "Review fetch stopped reporting progress",
				process: "Review Git process failed",
			}[reason]
		);
		this.name = "ReviewFetchProcessError";
	}
}

function diagnosticHints(stderr: string): string {
	const patterns: Array<[RegExp, string]> = [
		[/authentication failed|could not read (?:username|password)/i, "authentication failed"],
		[/permission denied \(publickey/i, "permission denied (publickey)"],
		[/(?:requested URL returned error:|HTTP[^\n]*)\s*(401|403)\b/i, "HTTP 403"],
		[/repository[^\n]*not found|requested URL returned error: 404\b/i, "repository not found"],
		[
			/not our ref|could(?:n't| not) find remote ref|unadvertised object|no such ref/i,
			"not our ref",
		],
		[/(?:operation|connection) timed out/i, "connection timed out"],
		[/could not resolve (?:host|proxy)/i, "could not resolve host"],
		[
			/failed to connect|couldn't connect|connection (?:reset|refused|closed)|network is unreachable/i,
			"failed to connect",
		],
		[
			/SSL (?:certificate|connect)|certificate verification failed/i,
			"SSL certificate verification failed",
		],
		[/RPC failed|early EOF|requested URL returned error: 5\d\d\b/i, "RPC failed"],
		[
			/no space left|read-only file system|cannot (?:write|mkdir)|unable to (?:create|write)|not a git repository|not a valid object|insufficient permission/i,
			"cannot write",
		],
	];
	return patterns
		.filter(([pattern]) => pattern.test(stderr))
		.map(([, hint]) => hint)
		.join("; ");
}

const stages: Record<string, ReviewFetchProgress["stage"]> = {
	"Enumerating objects": "enumerating",
	"Counting objects": "counting",
	"Compressing objects": "compressing",
	"Receiving objects": "receiving",
	"Resolving deltas": "resolving",
	"Checking out files": "checking",
	"Updating files": "checking",
	"Checking connectivity": "checking",
};
function number(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}
function parseLine(line: string): ReviewFetchProgress | undefined {
	const match =
		/^(?:remote:\s*)?(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Checking out files|Updating files|Checking connectivity):\s*(?:(\d{1,3})%\s*\((\d+)\/(\d+)\)|(\d+))(?:,\s*(\d+(?:\.\d+)?)\s*(B|bytes?|KiB|MiB|GiB)(?:\s*\|\s*\d+(?:\.\d+)?\s*(?:B|bytes?|KiB|MiB|GiB)\/s)?)?(?:,?\s*done\.?)?\s*$/.exec(
			line
		);
	if (!match) return undefined;
	const stage = stages[match[1] ?? ""];
	const percent = number(match[2]);
	const current = number(match[3] ?? match[5]);
	const total = number(match[4]);
	if (
		!stage ||
		current === undefined ||
		(match[4] !== undefined && total === undefined) ||
		(percent !== undefined && percent > 100) ||
		(total !== undefined && total < current)
	)
		return undefined;
	const size =
		match[6] === undefined
			? undefined
			: Number(match[6]) *
				({ B: 1, byte: 1, bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[match[7] ?? "B"] ??
					1);
	if (size !== undefined && (!Number.isFinite(size) || size < 0 || size > Number.MAX_SAFE_INTEGER))
		return undefined;
	return {
		stage,
		...(percent === undefined ? {} : { percent }),
		current,
		...(total === undefined ? {} : { total }),
		...(size === undefined ? {} : { bytes: Math.round(size) }),
	};
}

/** Git uses CR-delimited progress; ignore unrecognized output instead of forwarding it. */
export function createReviewFetchProgressParser(
	onProgress: (progress: ReviewFetchProgress) => void
) {
	let line = "";
	let truncated = false;
	const previous = new Map<ReviewFetchProgress["stage"], ReviewFetchProgress>();
	const flush = () => {
		if (!truncated) {
			const parsed = parseLine(line);
			if (parsed) {
				const before = previous.get(parsed.stage);
				if (
					!before ||
					(["current", "total", "percent", "bytes"] as const).some(
						(key) => (parsed[key] ?? -1) > (before[key] ?? -1)
					)
				) {
					// Remember high-water counters so repeated or regressing progress cannot keep a stall alive.
					previous.set(parsed.stage, {
						...parsed,
						...Object.fromEntries(
							(["current", "total", "percent", "bytes"] as const)
								.filter((key) => before?.[key] !== undefined || parsed[key] !== undefined)
								.map((key) => [key, Math.max(parsed[key] ?? -1, before?.[key] ?? -1)])
						),
					});
					onProgress(parsed);
				}
			}
		}
		line = "";
		truncated = false;
	};
	return {
		push(chunk: string) {
			for (const char of chunk) {
				if (char === "\r" || char === "\n") flush();
				else if (!truncated) {
					if (line.length < LINE_LIMIT) line += char;
					else {
						line = "";
						truncated = true;
					}
				}
			}
		},
		end: flush,
	};
}

export interface ReviewFetchProcessOptions {
	onProgress?: (progress: ReviewFetchProgress) => void;
	idleTimeoutMs?: number;
	maxDurationMs?: number;
	/** Internal process-boundary test seam. Never supplied by renderer input. */
	executable?: string;
}

/** Stream Git progress, retain bounded diagnostics, and own every spawned descendant. */
export function runReviewFetchGit(
	root: string,
	args: string[],
	callerSignal: AbortSignal,
	env: NodeJS.ProcessEnv,
	options: ReviewFetchProcessOptions = {}
): Promise<void> {
	if (callerSignal.aborted) return Promise.reject(new ReviewFetchProcessError("cancelled"));
	const maximum =
		options.maxDurationMs ?? (args[0] === "init" ? 45_000 : REVIEW_FETCH_MAX_DURATION_MS);
	const inactivity = options.idleTimeoutMs ?? REVIEW_FETCH_IDLE_TIMEOUT_MS;
	return new Promise((resolve, reject) => {
		const child = spawn(
			options.executable ?? "git",
			["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
			{
				cwd: root,
				env: { ...env, LC_ALL: "C" },
				detached: process.platform !== "win32",
				stdio: ["ignore", "ignore", "pipe"],
				windowsHide: true,
			}
		);
		let diagnostic = "";
		let reason: ReviewFetchProcessError["reason"] | undefined;
		let spawnCode: string | undefined;
		let ended = false;
		let idleTimer: ReturnType<typeof setTimeout> | undefined;
		let escalation: ReturnType<typeof setTimeout> | undefined;
		const kill = (signal: NodeJS.Signals) => {
			if (!child.pid) return;
			try {
				if (process.platform !== "win32") process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {
				/* The child may have exited before the signal. */
			}
		};
		const stop = (next: ReviewFetchProcessError["reason"]) => {
			if (ended || reason) return;
			reason = next;
			clearTimeout(idleTimer);
			kill("SIGTERM");
			escalation = setTimeout(() => kill("SIGKILL"), 250);
			escalation.unref?.();
		};
		const resetIdle = () => {
			clearTimeout(idleTimer);
			idleTimer = setTimeout(() => stop("stalled"), inactivity);
			idleTimer.unref?.();
		};
		const parser = createReviewFetchProgressParser((progress) => {
			if (ended || reason) return;
			resetIdle();
			// Observation failure cannot orphan the owned process or crash the main event loop.
			try {
				options.onProgress?.(progress);
			} catch {
				/* Fetch authority is independent of UI observation. */
			}
		});
		const decoder = new StringDecoder("utf8");
		child.stderr.on("data", (data: Buffer) => {
			const chunk = decoder.write(data);
			diagnostic = (diagnostic + chunk).slice(-STDERR_LIMIT);
			parser.push(chunk);
		});
		child.stderr.on("end", () => {
			parser.push(decoder.end());
			parser.end();
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			spawnCode = error.code;
			reason ??= "process";
		});
		const deadline = setTimeout(() => stop("timeout"), maximum);
		deadline.unref?.();
		resetIdle();
		const abort = () => stop("cancelled");
		callerSignal.addEventListener("abort", abort, { once: true });
		if (callerSignal.aborted) abort();
		child.once("close", (code, signal) => {
			ended = true;
			if (reason) kill("SIGKILL");
			clearTimeout(deadline);
			clearTimeout(idleTimer);
			clearTimeout(escalation);
			callerSignal.removeEventListener("abort", abort);
			if (reason || code !== 0)
				reject(
					new ReviewFetchProcessError(
						reason ?? "process",
						code,
						signal,
						diagnosticHints(diagnostic),
						spawnCode
					)
				);
			else resolve();
		});
	});
}
