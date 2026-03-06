import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as pty from "node-pty";

const MAX_BUFFER_BYTES = 200_000;

interface TerminalEntry {
	pty: pty.IPty;
	cwd: string;
	buffer: string;
	dataListeners: Map<string, (data: string) => void>;
	exitListeners: Map<string, (code: number, finalBuffer: string) => void>;
}

export function trimBuffer(buffer: string, maxBytes: number): string {
	if (buffer.length <= maxBytes) return buffer;
	return buffer.slice(buffer.length - maxBytes);
}

function resolveShell(): string {
	const candidates = [process.env["SHELL"], "/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const sh of candidates) {
		if (sh && existsSync(sh)) return sh;
	}
	return "/bin/sh";
}

function resolveEnv(): Record<string, string> {
	const base = Object.fromEntries(
		Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
	);
	const defaults = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
	base["PATH"] = base["PATH"] ? `${base["PATH"]}:${defaults}` : defaults;
	return base;
}

export class PtyManager {
	private terminals = new Map<string, TerminalEntry>();

	create(
		id: string,
		cwd: string | undefined,
		onData: (data: string) => void,
		onExit: (code: number, finalBuffer: string) => void,
		clientId: string
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
			env: resolveEnv(),
		});

		const entry: TerminalEntry = {
			pty: ptyProcess,
			cwd: resolvedCwd,
			buffer: "",
			dataListeners: new Map([[clientId, onData]]),
			exitListeners: new Map([[clientId, onExit]]),
		};

		ptyProcess.onData((data) => {
			entry.buffer = trimBuffer(entry.buffer + data, MAX_BUFFER_BYTES);
			for (const cb of entry.dataListeners.values()) cb(data);
		});

		ptyProcess.onExit(({ exitCode }) => {
			const finalBuffer = entry.buffer; // capture before delete
			this.terminals.delete(id);
			for (const cb of entry.exitListeners.values()) cb(exitCode, finalBuffer);
		});

		this.terminals.set(id, entry);
	}

	// Returns the buffered content, or null if the session does not exist.
	attach(
		id: string,
		onData: (data: string) => void,
		onExit: (code: number, finalBuffer: string) => void,
		clientId: string
	): string | null {
		const entry = this.terminals.get(id);
		if (!entry) return null;
		entry.dataListeners.set(clientId, onData);
		entry.exitListeners.set(clientId, onExit);
		return entry.buffer;
	}

	detachClient(clientId: string): void {
		for (const entry of this.terminals.values()) {
			entry.dataListeners.delete(clientId);
			entry.exitListeners.delete(clientId);
		}
	}

	write(id: string, data: string): void {
		const terminal = this.terminals.get(id);
		if (!terminal) {
			console.warn(`[pty-manager] write: terminal "${id}" not found`);
			return;
		}
		terminal.pty.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		const terminal = this.terminals.get(id);
		if (!terminal) {
			console.warn(`[pty-manager] resize: terminal "${id}" not found`);
			return;
		}
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
		}
	}

	has(id: string): boolean {
		return this.terminals.has(id);
	}

	list(): Array<{ id: string; cwd: string; pid: number }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			pid: e.pty.pid,
		}));
	}

	getBuffer(id: string): string {
		return this.terminals.get(id)?.buffer ?? "";
	}

	resetBuffer(id: string): void {
		const entry = this.terminals.get(id);
		if (entry) entry.buffer = "";
	}

	getAllBuffers(): Array<{ id: string; cwd: string; buffer: string }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			buffer: e.buffer,
		}));
	}

	disposeAll(): void {
		for (const [, entry] of this.terminals) {
			try {
				entry.pty.kill("SIGKILL");
			} catch {}
		}
		this.terminals.clear();
	}
}
