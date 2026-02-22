import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as pty from "node-pty";

export interface TerminalInstance {
	id: string;
	pty: pty.IPty;
	cleanup: () => void;
}

function resolveShell(): string {
	const candidates = [process.env["SHELL"], "/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const sh of candidates) {
		if (sh && existsSync(sh)) return sh;
	}
	return "/bin/sh";
}

function resolveEnv(): Record<string, string> {
	const env = { ...process.env } as Record<string, string>;
	// macOS GUI apps get a minimal PATH; ensure common dirs are present
	const defaults = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
	env["PATH"] = env["PATH"] ? `${env["PATH"]}:${defaults}` : defaults;
	return env;
}

class TerminalManager {
	private terminals: Map<string, TerminalInstance> = new Map();

	create(id: string, onData: (data: string) => void, onExit: (code: number) => void, cwd?: string): void {
		const shell = resolveShell();

		const ptyProcess = pty.spawn(shell, ["-l"], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: cwd || homedir(),
			env: resolveEnv(),
		});

		const dataDisposable = ptyProcess.onData(onData);
		const exitDisposable = ptyProcess.onExit(({ exitCode }) => {
			this.terminals.delete(id);
			onExit(exitCode);
		});

		const cleanup = () => {
			dataDisposable.dispose();
			exitDisposable.dispose();
		};

		this.terminals.set(id, { id, pty: ptyProcess, cleanup });
	}

	write(id: string, data: string): void {
		const terminal = this.terminals.get(id);
		if (terminal) {
			terminal.pty.write(data);
		}
	}

	resize(id: string, cols: number, rows: number): void {
		const terminal = this.terminals.get(id);
		if (terminal) {
			terminal.pty.resize(cols, rows);
		}
	}

	dispose(id: string): void {
		const terminal = this.terminals.get(id);
		if (terminal) {
			terminal.cleanup();
			terminal.pty.kill();
			this.terminals.delete(id);
		}
	}

	has(id: string): boolean {
		return this.terminals.has(id);
	}

	disposeAll(): void {
		for (const [, terminal] of this.terminals) {
			terminal.cleanup();
			// SIGKILL ensures child processes die immediately so node-pty's native
			// ThreadSafeFunction has no pending I/O during Node environment teardown.
			terminal.pty.kill("SIGKILL");
		}
		this.terminals.clear();
	}
}

export const terminalManager = new TerminalManager();
