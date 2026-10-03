import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
	FILE_PASTE_MAX_BYTES,
	type FileDelivery,
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
	clients: Map<string, FileInputTarget | null>;
}
const POSIX = new Set(["sh", "bash", "zsh", "dash"]);
const AGENT_RUNTIMES = new Set(["node", "bun", "deno"]);
const LOCAL_INPUT = new Set([...POSIX, "claude", "codex", "gemini", "opencode"]);
const name = (process: string) => basename(process).replace(/^-/, "");
/** Optional capability; old daemons never receive these operations. */
export class FileInputSessions {
	private sessions = new Map<string, Session>();
	create(
		id: string,
		client: string,
		shell: string,
		foreground: () => string,
		write: (data: string) => void
	): void {
		this.sessions.set(id, { shell, foreground, write, clients: new Map([[client, null]]) });
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
		const target = {
			generation: randomUUID(),
			foreground,
			supported:
				POSIX.has(name(session.shell)) &&
				(LOCAL_INPUT.has(name(foreground)) ||
					(managedAgent && AGENT_RUNTIMES.has(name(foreground)))),
		};
		session.clients.set(client, target);
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
		if (
			!target.supported ||
			session.foreground() !== target.foreground ||
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
