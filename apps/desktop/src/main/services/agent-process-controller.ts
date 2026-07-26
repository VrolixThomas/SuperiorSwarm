import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentProvider } from "../../shared/agent-session";
import type { DaemonSession } from "../../shared/daemon-protocol";
import type { DaemonClient } from "../terminal/daemon-client";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 100;
const TERMINATE_TIMEOUT_MS = 4_000;

export interface AgentTerminationResult {
	ok: boolean;
	alreadyStopped?: boolean;
	error?: string;
}

export type AgentForegroundInspection =
	| { status: "agent" }
	| { status: "shell" }
	| { status: "other" }
	| { status: "missing" }
	| { status: "unknown"; error: string };

export interface AgentProcessController {
	terminateForeground(terminalId: string, provider: AgentProvider): Promise<AgentTerminationResult>;
	inspectForeground(
		terminalId: string,
		provider: AgentProvider
	): Promise<AgentForegroundInspection>;
}

export function matchesProviderCommand(command: string, provider: AgentProvider): boolean {
	const normalized = command.trim().toLowerCase();
	const executable = normalized.split(/\s+/, 1)[0] ?? "";
	const basename =
		executable
			.split(/[\\/]/)
			.pop()
			?.replace(/\.exe$/, "") ?? "";
	if (basename === provider) return true;

	// Some CLIs run through node/bun and expose only their installed package path
	// in `ps`. Keep these markers provider-specific and avoid loose substring
	// matches that could terminate an unrelated command mentioning "codex", etc.
	switch (provider) {
		case "claude":
			return (
				normalized.includes("/.claude/versions/") || normalized.includes("\\.claude\\versions\\")
			);
		case "codex":
			return normalized.includes("/@openai/codex/") || normalized.includes("\\@openai\\codex\\");
		case "gemini":
			return (
				normalized.includes("/@google/gemini-cli/") ||
				normalized.includes("\\@google\\gemini-cli\\")
			);
		case "opencode":
			return normalized.includes("/opencode-ai/") || normalized.includes("\\opencode-ai\\");
	}
}

export function matchesProviderProcessGroup(
	commands: readonly string[],
	provider: AgentProvider
): boolean {
	return commands.some((command) => matchesProviderCommand(command, provider));
}

interface ForegroundSnapshot {
	shellPgid: number;
	foregroundPgid: number;
	commands: string[];
}

async function inspectProcessGroup(pgid: number): Promise<string[]> {
	const { stdout } = await execFileAsync("ps", ["-axo", "pgid=,command="]);
	const commands: string[] = [];
	for (const line of stdout.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(.+)$/);
		if (match && Number(match[1]) === pgid && match[2]) {
			commands.push(match[2].trim());
		}
	}
	return commands;
}

async function inspectForegroundSnapshot(shellPid: number): Promise<ForegroundSnapshot | null> {
	try {
		const { stdout } = await execFileAsync("ps", [
			"-p",
			String(shellPid),
			"-o",
			"pgid=",
			"-o",
			"tpgid=",
		]);
		const match = stdout.trim().match(/^(\d+)\s+(-?\d+)$/);
		if (!match) return null;
		const shellPgid = Number(match[1]);
		const foregroundPgid = Number(match[2]);
		if (!Number.isInteger(foregroundPgid) || foregroundPgid <= 0) return null;
		if (foregroundPgid === shellPgid) {
			return { shellPgid, foregroundPgid, commands: [] };
		}
		return {
			shellPgid,
			foregroundPgid,
			commands: await inspectProcessGroup(foregroundPgid),
		};
	} catch {
		return null;
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PosixAgentProcessController implements AgentProcessController {
	constructor(private readonly daemonClient: DaemonClient) {}

	async inspectForeground(
		terminalId: string,
		provider: AgentProvider
	): Promise<AgentForegroundInspection> {
		if (process.platform === "win32") {
			return {
				status: "unknown",
				error: "Agent foreground inspection is not supported on Windows yet",
			};
		}

		let session: DaemonSession | undefined;
		try {
			session = (await this.daemonClient.listSessions()).find(
				(candidate) => candidate.id === terminalId
			);
		} catch (error) {
			return {
				status: "unknown",
				error: error instanceof Error ? error.message : "Could not list terminal sessions",
			};
		}
		if (!session) return { status: "missing" };

		const snapshot = await inspectForegroundSnapshot(session.pid);
		if (!snapshot) {
			return {
				status: "unknown",
				error: "Could not inspect the terminal foreground process",
			};
		}
		if (snapshot.foregroundPgid === snapshot.shellPgid) return { status: "shell" };
		if (snapshot.commands.length === 0) {
			// A terminated foreground group can briefly remain as the TTY's tpgid
			// before the shell reclaims it. No surviving process means there is no
			// agent to resume, so recover this as a hibernated shell.
			return { status: "shell" };
		}
		return matchesProviderProcessGroup(snapshot.commands, provider)
			? { status: "agent" }
			: { status: "other" };
	}

	async terminateForeground(
		terminalId: string,
		provider: AgentProvider
	): Promise<AgentTerminationResult> {
		if (process.platform === "win32") {
			return { ok: false, error: "Automatic agent sleep is not supported on Windows yet" };
		}

		const session = (await this.daemonClient.listSessions()).find(
			(candidate) => candidate.id === terminalId
		);
		if (!session) return { ok: false, error: "Terminal session is no longer running" };

		const snapshot = await inspectForegroundSnapshot(session.pid);
		if (!snapshot) return { ok: false, error: "Could not inspect the terminal foreground process" };
		if (snapshot.foregroundPgid === snapshot.shellPgid) {
			return { ok: true, alreadyStopped: true };
		}
		if (snapshot.commands.length === 0) {
			return { ok: false, error: "Could not inspect the terminal foreground process group" };
		}
		if (!matchesProviderProcessGroup(snapshot.commands, provider)) {
			return {
				ok: false,
				error: `Foreground process is not the expected ${provider} agent`,
			};
		}

		try {
			process.kill(-snapshot.foregroundPgid, "SIGTERM");
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ESRCH") return { ok: true, alreadyStopped: true };
			return {
				ok: false,
				error: error instanceof Error ? error.message : "Failed to terminate agent",
			};
		}

		const deadline = Date.now() + TERMINATE_TIMEOUT_MS;
		while (Date.now() < deadline) {
			await wait(POLL_INTERVAL_MS);
			const current = await inspectForegroundSnapshot(session.pid);
			if (
				!current ||
				current.foregroundPgid === current.shellPgid ||
				!matchesProviderProcessGroup(current.commands, provider)
			) {
				return { ok: true };
			}
		}

		return {
			ok: false,
			error: `${provider} did not exit after SIGTERM; automatic sleep was cancelled`,
		};
	}
}
