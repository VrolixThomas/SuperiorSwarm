import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
	FILE_PASTE_MAX_BYTES,
	type FileDelivery,
	type TerminalProcessIdentity,
	hasUnsafeTerminalText,
	isFilePaste,
} from "../shared/terminal-files";

export interface FileInputTarget {
	generation: string;
	foreground: string;
	supported: boolean;
}
interface Session {
	shell: string;
	foreground: () => string;
	write: (data: string) => void;
	inspect?: () => TerminalProcessIdentity | null;
	clients: Map<string, (FileInputTarget & { identity?: TerminalProcessIdentity }) | null>;
}
const POSIX = new Set(["sh", "bash", "zsh", "dash"]);
const AGENT_RUNTIMES = new Set(["node", "bun", "deno"]);
const LOCAL_INPUT = new Set([...POSIX, "claude", "codex", "gemini", "opencode"]);
// macOS reports the version filename as Claude's kernel process name. Only the
// OS-inspected executable path can distinguish it from an arbitrary numeric name.
function nativeClaude(executable: string): boolean {
	return /\/(?:\.local\/share\/claude|\.claude)\/versions\/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
		executable
	);
}
function sameIdentity(a: TerminalProcessIdentity, b: TerminalProcessIdentity): boolean {
	return a.pid === b.pid && a.startedAt === b.startedAt && a.executable === b.executable;
}
const name = (process: string) => basename(process).replace(/^-/, "");
/** Optional capability; old daemons never receive these operations. */
export class FileInputSessions {
	private sessions = new Map<string, Session>();
	create(
		id: string,
		client: string,
		shell: string,
		foreground: () => string,
		write: (data: string) => void,
		inspect?: () => TerminalProcessIdentity | null
	): void {
		this.sessions.set(id, {
			shell,
			foreground,
			write,
			inspect,
			clients: new Map([[client, null]]),
		});
	}
	attach(id: string, client: string): void {
		this.sessions.get(id)?.clients.set(client, null);
	}
	detach(id: string, client: string): void {
		this.sessions.get(id)?.clients.delete(client);
	}
	input(id: string, data: string): void {
		if (!data.includes("\r") && !data.includes("\n") && !data.includes("\x03")) return;
		const session = this.sessions.get(id);
		if (session) for (const client of session.clients.keys()) session.clients.set(client, null);
	}
	clear(): void {
		this.sessions.clear();
	}
	remove(id: string): void {
		this.sessions.delete(id);
	}
	target(id: string, client: string, managedAgent = false): FileInputTarget | null {
		const session = this.sessions.get(id);
		if (!session?.clients.has(client)) return null;
		const foreground = session.foreground();
		const identity = session.inspect?.() ?? undefined;
		const executable = identity?.executable ?? foreground;
		const target = {
			generation: randomUUID(),
			foreground,
			supported:
				POSIX.has(name(session.shell)) &&
				(!session.inspect || Boolean(identity)) &&
				(LOCAL_INPUT.has(name(executable)) ||
					(identity !== undefined && nativeClaude(executable)) ||
					(managedAgent && AGENT_RUNTIMES.has(name(executable)))),
		};
		session.clients.set(client, { ...target, identity });
		return target;
	}
	insert(
		id: string,
		client: string,
		generation: string,
		text: string,
		payload: string,
		submit = false
	): FileDelivery {
		const session = this.sessions.get(id);
		const target = session?.clients.get(client);
		if (!session || !target || target.generation !== generation) return "rejected";
		session.clients.set(client, null); // consume before any handoff, never retry
		const current = target.identity ? session.inspect?.() : undefined;
		if (
			!target.supported ||
			(target.identity
				? !current || !sameIdentity(target.identity, current)
				: session.foreground() !== target.foreground) ||
			typeof text !== "string" ||
			typeof payload !== "string" ||
			!text.length ||
			Buffer.byteLength(text) > FILE_PASTE_MAX_BYTES ||
			hasUnsafeTerminalText(text) ||
			!isFilePaste(text, payload)
		)
			return "rejected";
		try {
			// Only the explicit send operation may forward the user's Enter.
			session.write(submit === true ? `${payload}\r` : payload);
			return "admitted";
		} catch {
			return "uncertain";
		}
	}
}
