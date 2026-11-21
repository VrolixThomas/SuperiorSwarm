import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as pty from "node-pty";
import { MAX_SCROLLBACK_CHARS } from "../shared/daemon-protocol";
import type { QueueLaunchOwner } from "../shared/queue-resume";
import type { TerminalProcessIdentity } from "../shared/terminal-files";

const MAX_BUFFER_CHARS = MAX_SCROLLBACK_CHARS;
class SpawnedProcessError extends Error {}

import { FileInputSessions } from "./file-input-sessions";
import { shellIntegrationEnv } from "./shell-integration";
import {
	readTerminalProcessEnvironment,
	readTerminalProcessIdentity,
} from "./terminal-process-identity";
import { TerminalReplayBuffer } from "./terminal-replay-buffer";

interface TerminalEntry {
	env: Record<string, string>;
	shell: string;
	kind: "shell" | "provider";
	cols: number;
	rows: number;

	pty: pty.IPty;
	cwd: string;
	buffer: string;
	replay: TerminalReplayBuffer;
	dirty: boolean;
	dataListeners: Map<string, (data: string) => void>;
	exitListeners: Map<string, (code: number, finalBuffer: string) => void>;
}

export function trimBuffer(buffer: string, maxChars: number): string {
	if (buffer.length <= maxChars) return buffer;
	return buffer.slice(buffer.length - maxChars);
}

function resolveShell(): string {
	const candidates = [process.env["SHELL"], "/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const sh of candidates) {
		if (sh && existsSync(sh)) return sh;
	}
	return "/bin/sh";
}

function resolveEnv(extra?: Record<string, string>): Record<string, string> {
	const base = Object.fromEntries(
		Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
	);
	const defaults = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
	base["PATH"] = base["PATH"] ? `${base["PATH"]}:${defaults}` : defaults;
	if (extra) {
		Object.assign(base, extra);
	}
	return base;
}

export class PtyManager {
	constructor(
		private readonly backend: {
			spawn?: typeof pty.spawn;
			inspect?: (pid: number) => TerminalProcessIdentity | null;
			replay?: () => TerminalReplayBuffer;
			signal?: (pid: number) => void;
			environment?: (identity: TerminalProcessIdentity) => Record<string, string> | null;
		} = {}
	) {}
	private spawnProcess: typeof pty.spawn = (...args) => (this.backend.spawn ?? pty.spawn)(...args);
	private inspectProcess = (pid: number) =>
		(this.backend.inspect ?? readTerminalProcessIdentity)(pid);

	private terminals = new Map<string, TerminalEntry>();
	readonly fileInputs = new FileInputSessions((identity) =>
		(this.backend.environment ?? readTerminalProcessEnvironment)(identity)
	);

	create(
		id: string,
		cwd: string | undefined,
		onData: (data: string) => void,
		onExit: (code: number, finalBuffer: string) => void,
		clientId: string,
		env?: Record<string, string>
	): void {
		if (this.terminals.has(id)) {
			throw new Error(`Terminal "${id}" already exists`);
		}

		const resolvedCwd = cwd ?? homedir();
		const shell = resolveShell();
		const ptyProcess = this.spawnProcess(shell, ["-l"], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: resolvedCwd,
			env: shellIntegrationEnv(shell, resolveEnv(env)),
		});

		const entry: TerminalEntry = {
			env: resolveEnv(env),
			shell,
			kind: "shell",
			cols: 80,
			rows: 24,
			pty: ptyProcess,
			cwd: resolvedCwd,
			buffer: "",
			replay: this.backend.replay?.() ?? new TerminalReplayBuffer(),
			dirty: false,
			dataListeners: new Map([[clientId, onData]]),
			exitListeners: new Map([[clientId, onExit]]),
		};

		this.bindProcess(id, entry);

		this.terminals.set(id, entry);
		this.fileInputs.create(
			id,
			clientId,
			shell,
			() => ptyProcess.process ?? "",
			(data) => ptyProcess.write(data),
			this.backend.inspect || process.platform === "darwin"
				? () => this.inspectProcess(ptyProcess.pid)
				: undefined
		);
	}

	private bindProcess(id: string, entry: TerminalEntry): void {
		entry.pty.onData((data) => {
			if (this.terminals.get(id) !== entry) return;
			entry.replay.write(data, (output) => {
				const active = this.terminals.get(id);
				if (!active || active.replay !== entry.replay || !output) return;
				active.buffer = trimBuffer(active.buffer + output, MAX_BUFFER_CHARS);
				active.dirty = true;
				// Framing can join a large OSC/DCS split across PTY chunks. Keep
				// live transport frames within the limit accepted by old clients.
				for (let start = 0; start < output.length; ) {
					let end = Math.min(start + MAX_BUFFER_CHARS, output.length);
					const last = output.charCodeAt(end - 1);
					if (end < output.length && last >= 0xd800 && last <= 0xdbff) end--;
					const chunk = output.slice(start, end);
					for (const cb of active.dataListeners.values()) cb(chunk);
					start = end;
				}
			});
		});

		entry.pty.onExit(({ exitCode }) => {
			if (this.terminals.get(id) === entry && entry.kind === "provider") {
				try {
					this.replaceProcess(id, entry, entry.shell, ["-l"], "shell");
					return;
				} catch {
					/* Fall through to honest terminal exit. */
				}
			}
			// Guard: only act if this PTY is still the active one for this id.
			// A dispose() followed by create() with the same id can replace the entry
			// before this callback fires, and we must not delete or notify for the new one.
			if (this.terminals.get(id) !== entry) return;
			entry.replay.afterWrites(() => {
				if (this.terminals.get(id) !== entry) return;
				const finalBuffer = entry.replay.snapshot();
				this.terminals.delete(id);
				this.fileInputs.remove(id);
				for (const cb of entry.exitListeners.values()) cb(exitCode, finalBuffer);
				entry.replay.dispose();
			});
		});
	}
	private replaceProcess(
		id: string,
		previous: TerminalEntry,
		executable: string,
		args: string[],
		kind: "shell" | "provider",
		environment?: Record<string, string>
	): TerminalEntry {
		if (this.terminals.get(id) !== previous) throw Error("Terminal generation changed");
		const process = this.spawnProcess(executable, args, {
			name: "xterm-256color",
			cols: previous.cols,
			rows: previous.rows,
			cwd: previous.cwd,
			env: kind === "shell" ? shellIntegrationEnv(previous.shell, previous.env) : environment,
		});
		const next: TerminalEntry = { ...previous, pty: process, kind, dirty: true };
		try {
			this.bindProcess(id, next);
			this.terminals.set(id, next);
			this.fileInputs.replaceTransport(
				id,
				() => process.process ?? "",
				(data) => process.write(data),
				() => this.inspectProcess(process.pid)
			);
			if (kind === "provider") this.fileInputs.trustedLaunchProcess(id, process.pid);
			return next;
		} catch (error) {
			if (this.terminals.get(id) === next) this.terminals.set(id, previous);
			try {
				process.kill("SIGKILL");
			} catch {}
			throw new SpawnedProcessError(
				error instanceof Error ? error.message : "Provider startup interrupted"
			);
		}
	}
	completeQueueSleep(id: string, generation: string): boolean {
		const entry = this.terminals.get(id);
		return (
			!!entry &&
			entry.kind === "shell" &&
			this.fileInputs.completeSleep(id, generation, entry.pty.pid)
		);
	}
	signalQueueSleep(id: string, generation: string): boolean {
		const entry = this.terminals.get(id);
		const identity = this.fileInputs.sleepProcess(id, generation);
		if (!entry || !identity) return false;
		try {
			if (this.backend.signal) this.backend.signal(identity.pid);
			else process.kill(-identity.pid, "SIGTERM");
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	}

	async parkQueueRoot(id: string, generation: string): Promise<boolean> {
		const entry = this.terminals.get(id);
		if (!entry || entry.kind !== "provider" || !this.fileInputs.canPark(id, generation))
			return false;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				subscription.dispose();
				resolve(false);
			}, 2000);
			const subscription = entry.pty.onExit(() => {
				clearTimeout(timer);
				subscription.dispose();
				resolve(this.terminals.get(id)?.kind === "shell");
			});
			try {
				entry.pty.kill("SIGTERM");
			} catch {
				clearTimeout(timer);
				subscription.dispose();
				resolve(false);
			}
		});
	}
	resumeQueueProcess(
		id: string,
		client: string,
		generation: string,
		content: string | undefined,
		owner: QueueLaunchOwner
	): "admitted" | "rejected" | "uncertain" {
		const previous = this.terminals.get(id);
		if (!previous || previous.kind !== "shell") return "rejected";
		const launch = this.fileInputs.takeResume(id, client, generation, content, owner);
		if (!launch) return "rejected";
		try {
			this.replaceProcess(
				id,
				previous,
				launch.executable,
				launch.args,
				"provider",
				launch.environment
			);
			this.fileInputs.admittedArgvPrompt(id, launch.provider, launch.providerSessionId, content);
			try {
				previous.pty.kill("SIGKILL");
			} catch {}
			return "admitted";
		} catch (error) {
			return error instanceof SpawnedProcessError || this.terminals.get(id) !== previous
				? "uncertain"
				: "rejected";
		}
	}

	// Returns the buffered content and current foreground process name,
	// or null if the session does not exist.
	attach(
		id: string,
		onData: (data: string) => void,
		onExit: (code: number, finalBuffer: string) => void,
		clientId: string,
		snapshot = false
	): { buffer: string; process: string } | null {
		const entry = this.terminals.get(id);
		if (!entry) return null;
		this.fileInputs.attach(id, clientId);
		entry.dataListeners.set(clientId, onData);
		entry.exitListeners.set(clientId, onExit);
		return {
			buffer: snapshot ? entry.replay.snapshot() : entry.buffer,
			process: entry.pty.process ?? "",
		};
	}

	// Detach one client from one session. Returns true if the client had
	// listeners on that session. Other sessions and other clients are untouched.
	detachSession(clientId: string, id: string): boolean {
		const entry = this.terminals.get(id);
		if (!entry) return false;
		this.fileInputs.detach(id, clientId);
		const had = entry.dataListeners.delete(clientId);
		entry.exitListeners.delete(clientId);
		return had;
	}

	detachClient(clientId: string): void {
		for (const id of this.terminals.keys()) {
			this.detachSession(clientId, id);
		}
	}

	write(id: string, data: string | Buffer): void {
		const terminal = this.terminals.get(id);
		if (!terminal) {
			console.warn(`[pty-manager] write: terminal "${id}" not found`);
			return;
		}
		this.fileInputs.input(id, data);
		terminal.pty.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		const terminal = this.terminals.get(id);
		if (!terminal) {
			console.warn(`[pty-manager] resize: terminal "${id}" not found`);
			return;
		}
		terminal.cols = cols;
		terminal.rows = rows;
		terminal.replay.resize(cols, rows);
		terminal.pty.resize(cols, rows);
	}

	dispose(id: string): void {
		const entry = this.terminals.get(id);
		if (entry) {
			// Clear exit listeners before killing so the SIGKILL doesn't trigger a
			// spurious exit notification to connected clients. Dispose is intentional
			// closure, not a terminal-exited event.
			entry.exitListeners.clear();
			try {
				entry.pty.kill("SIGKILL");
			} catch {}
			this.terminals.delete(id);
			entry.replay.dispose();
			this.fileInputs.remove(id);
		}
	}

	has(id: string): boolean {
		return this.terminals.has(id);
	}

	get terminalCount(): number {
		return this.terminals.size;
	}

	list(): Array<{ id: string; cwd: string; pid: number; processKind?: "provider" }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			pid: e.pty.pid,
			...(e.kind === "provider" ? { processKind: "provider" as const } : {}),
		}));
	}

	getBuffer(id: string): string {
		return this.terminals.get(id)?.replay.snapshot() ?? "";
	}

	getAllBuffers(): Array<{ id: string; cwd: string; buffer: string }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			buffer: e.replay.snapshot(),
		}));
	}

	getDirtyBuffers(): Array<{ id: string; cwd: string; buffer: string }> {
		return [...this.terminals.entries()]
			.filter(([, entry]) => entry.dirty)
			.map(([id, entry]) => ({
				id,
				cwd: entry.cwd,
				buffer: entry.replay.snapshot(),
			}));
	}

	markBuffersFlushed(ids: readonly string[]): void {
		for (const id of ids) {
			const entry = this.terminals.get(id);
			if (entry) entry.dirty = false;
		}
	}

	disposeAll(): void {
		for (const [, entry] of this.terminals) {
			entry.exitListeners.clear();
			entry.replay.dispose();
			try {
				entry.pty.kill("SIGKILL");
			} catch {}
		}
		this.terminals.clear();
		this.fileInputs.clear();
	}
}
