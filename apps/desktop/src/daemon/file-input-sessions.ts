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
	inputVersion: number;
	submittedVersion: number | null;
	prompt?: { key: string; version: number; identity: TerminalProcessIdentity };
	readyKey?: string;
	inputDirty: boolean;
	shell: string;
	foreground: () => string;
	write: (data: string) => void;
	inspect?: () => TerminalProcessIdentity | null;
	clients: Map<
		string,
		(FileInputTarget & { identity?: TerminalProcessIdentity; conversation?: boolean }) | null
	>;
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
export function sameTerminalProcess(
	a: TerminalProcessIdentity,
	b: TerminalProcessIdentity
): boolean {
	return a.pid === b.pid && a.startedAt === b.startedAt && a.executable === b.executable;
}
const name = (process: string) => basename(process).replace(/^-/, "");
export function supportsLocalFileInput(
	identity: TerminalProcessIdentity,
	managedAgent = false
): boolean {
	return (
		LOCAL_INPUT.has(name(identity.executable)) ||
		nativeClaude(identity.executable) ||
		(managedAgent && AGENT_RUNTIMES.has(name(identity.executable)))
	);
}
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
			inputDirty: true,
			inputVersion: 0,
			submittedVersion: null,
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
	input(id: string, data: string | Buffer): void {
		// Terminal device replies are protocol traffic, not a user draft.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: exact ANSI cursor-position reply
		if (/^\x1b\[\d{1,5};\d{1,5}R$/.test(String(data))) return;
		const active = this.sessions.get(id);
		if (active && data.length) {
			active.inputDirty = true;
			active.inputVersion += data.length;
			if (String(data).endsWith("\r")) active.submittedVersion = active.inputVersion;
		}
		if (data.length && active)
			for (const [client, lease] of active.clients) {
				if (lease?.conversation) active.clients.set(client, null);
			}
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
	conversationState(
		id: string,
		state: import("../shared/queue-terminal-state").QueueTerminalState
	): void {
		const session = this.sessions.get(id);
		if (!session) return;
		const key = JSON.stringify([state.provider, state.providerSessionId, state.turnId]);
		if (state.phase === "reset") {
			session.prompt = undefined;
			session.readyKey = undefined;
			session.inputDirty = true;
			return;
		}
		if (state.phase === "blocked") {
			session.readyKey = undefined;
			session.inputDirty = true;
			return;
		}
		if (state.phase === "prompt") {
			session.readyKey = undefined;
			if (session.prompt?.key === key) return;
			const identity = session.inspect?.();
			session.prompt =
				identity && session.submittedVersion !== null
					? { key, version: session.submittedVersion, identity }
					: undefined;
			return;
		}
		const identity = session.inspect?.();
		if (
			session.prompt?.key === key &&
			session.prompt.version === session.inputVersion &&
			identity &&
			sameTerminalProcess(session.prompt.identity, identity)
		) {
			session.inputDirty = false;
			session.readyKey = key;
		}
	}
	/** No shell/runtime heuristics: require OS-inspected native provider identity. */
	conversationTarget(
		id: string,
		client: string,
		provider: string,
		providerSessionId: string
	): FileInputTarget | null {
		const session = this.sessions.get(id);
		if (!session?.clients.has(client)) return null;
		const identity = session.inspect?.();
		const target = {
			generation: randomUUID(),
			foreground: identity?.name ?? "",
			supported:
				!session.inputDirty &&
				!!session.readyKey &&
				JSON.parse(session.readyKey)[0] === provider &&
				JSON.parse(session.readyKey)[1] === providerSessionId &&
				!!identity &&
				!!session.prompt &&
				sameTerminalProcess(session.prompt.identity, identity) &&
				((provider === "claude" &&
					(name(identity.executable) === "claude" || nativeClaude(identity.executable))) ||
					(provider === "codex" && name(identity.executable) === "codex")),
		};
		session.clients.set(client, { ...target, identity: identity ?? undefined, conversation: true });
		return target;
	}
	insertConversation(
		id: string,
		client: string,
		generation: string,
		text: string
	): Exclude<FileDelivery, "unconfirmed"> {
		const session = this.sessions.get(id);
		const target = session?.clients.get(client);
		if (!session || !target?.conversation || target.generation !== generation) return "rejected";
		session.clients.set(client, null);
		const current = session.inspect?.();
		if (
			!target.supported ||
			session.inputDirty ||
			!target.identity ||
			!current ||
			!sameTerminalProcess(target.identity, current) ||
			typeof text !== "string" ||
			!text.trim() ||
			Buffer.byteLength(text) > 16000 ||
			hasUnsafeTerminalText(text.replaceAll("\n", ""))
		)
			return "rejected";
		try {
			// Invalidate every client's lease before the single handoff.
			for (const owner of session.clients.keys()) session.clients.set(owner, null);
			const payload = `\x1b[200~${text}\x1b[201~\r`;
			session.inputDirty = true;
			session.readyKey = undefined;
			session.inputVersion += payload.length;
			session.submittedVersion = session.inputVersion;
			session.write(payload);
			return "admitted";
		} catch {
			return "uncertain";
		}
	}
	target(id: string, client: string, managedAgent = false): FileInputTarget | null {
		const session = this.sessions.get(id);
		if (!session?.clients.has(client)) return null;
		const foreground = session.foreground();
		const identity = session.inspect?.() ?? undefined;
		const target = {
			generation: randomUUID(),
			foreground,
			supported:
				POSIX.has(name(session.shell)) &&
				(!session.inspect || Boolean(identity)) &&
				(identity
					? supportsLocalFileInput(identity, managedAgent)
					: LOCAL_INPUT.has(name(foreground)) ||
						(managedAgent && AGENT_RUNTIMES.has(name(foreground)))),
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
	): Exclude<FileDelivery, "unconfirmed"> {
		const session = this.sessions.get(id);
		const target = session?.clients.get(client);
		if (!session || !target || target.conversation || target.generation !== generation)
			return "rejected";
		session.clients.set(client, null); // consume before any handoff, never retry
		const current = target.identity ? session.inspect?.() : undefined;
		if (
			!target.supported ||
			(target.identity
				? !current || !sameTerminalProcess(target.identity, current)
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
			// File insertion invalidates a competing Queue lease and preserves draft safety.
			session.inputDirty = true;
			session.inputVersion += payload.length + (submit ? 1 : 0);
			if (submit) session.submittedVersion = session.inputVersion;
			for (const [owner, lease] of session.clients)
				if (lease?.conversation) session.clients.set(owner, null);
			// Only the explicit send operation may forward the user's Enter.
			session.write(submit === true ? `${payload}\r` : payload);
			return "admitted";
		} catch {
			return "uncertain";
		}
	}
}
