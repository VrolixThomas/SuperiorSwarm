import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as pty from "node-pty";
import { MAX_SCROLLBACK_CHARS } from "../shared/daemon-protocol";

const MAX_BUFFER_CHARS = MAX_SCROLLBACK_CHARS;

import { FileInputSessions } from "./file-input-sessions";
import { readTerminalProcessIdentity } from "./terminal-process-identity";
import { TerminalReplayBuffer } from "./terminal-replay-buffer";

interface TerminalEntry {
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
	private terminals = new Map<string, TerminalEntry>();
	readonly fileInputs = new FileInputSessions();

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
		const ptyProcess = pty.spawn(shell, ["-l"], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: resolvedCwd,
			env: resolveEnv(env),
		});

		const entry: TerminalEntry = {
			pty: ptyProcess,
			cwd: resolvedCwd,
			buffer: "",
			replay: new TerminalReplayBuffer(),
			dirty: false,
			dataListeners: new Map([[clientId, onData]]),
			exitListeners: new Map([[clientId, onExit]]),
		};

		ptyProcess.onData((data) => {
			if (this.terminals.get(id) !== entry) return;
			entry.replay.write(data, (output) => {
				if (this.terminals.get(id) !== entry || !output) return;
				entry.buffer = trimBuffer(entry.buffer + output, MAX_BUFFER_CHARS);
				entry.dirty = true;
				// Framing can join a large OSC/DCS split across PTY chunks. Keep
				// live transport frames within the limit accepted by old clients.
				for (let start = 0; start < output.length; ) {
					let end = Math.min(start + MAX_BUFFER_CHARS, output.length);
					const last = output.charCodeAt(end - 1);
					if (end < output.length && last >= 0xd800 && last <= 0xdbff) end--;
					const chunk = output.slice(start, end);
					for (const cb of entry.dataListeners.values()) cb(chunk);
					start = end;
				}
			});
		});

		ptyProcess.onExit(({ exitCode }) => {
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

		this.terminals.set(id, entry);
		this.fileInputs.create(
			id,
			clientId,
			shell,
			() => ptyProcess.process ?? "",
			(data) => ptyProcess.write(data),
			process.platform === "darwin" ? () => readTerminalProcessIdentity(ptyProcess.pid) : undefined
		);
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

	list(): Array<{ id: string; cwd: string; pid: number }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			pid: e.pty.pid,
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
