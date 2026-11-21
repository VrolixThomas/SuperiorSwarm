import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { QUEUE_REPLY_MAX_CHARACTERS } from "../shared/activity-queue";
import { answerContinuationFits } from "../shared/queue-answer-continuation";
import {
	type QueueLaunchDescriptor,
	type QueueLaunchOwner,
	queueOwnerKey,
	queueResumeArgs,
	validQueueLaunch,
} from "../shared/queue-resume";
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
	launch?: {
		descriptor: QueueLaunchDescriptor;
		providerSessionId: string;
		owner: QueueLaunchOwner;
		executable: string;
		identity?: TerminalProcessIdentity;
		trustedPid?: number;
		binaryStamp: string;
	};
	sleep?: {
		generation: string;
		provider: string;
		providerSessionId: string;
		version: number;
		runningIdentity: TerminalProcessIdentity;
		identity?: TerminalProcessIdentity;
	};
	argvPrompt?: { provider: string; providerSessionId: string; hash: string; version: number };

	inputVersion: number;
	submittedVersions: number[];
	ambiguousInput?: boolean;
	prompt?: { key: string; version: number; identity: TerminalProcessIdentity };
	readyKey?: string;
	inputDirty: boolean;
	shell: string;
	foreground: () => string;
	write: (data: string) => void;
	inspect?: () => TerminalProcessIdentity | null;
	clients: Map<
		string,
		| (FileInputTarget & {
				identity?: TerminalProcessIdentity;
				conversation?: boolean;
				resume?: boolean;
		  })
		| null
	>;
}
function recordSubmission(session: Session): void {
	if (session.submittedVersions.length >= 64) session.ambiguousInput = true;
	else session.submittedVersions.push(session.inputVersion);
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
			submittedVersions: [],
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
		if (/^\x1b\[\d{1,5};\d{1,5}R$/.test(String(data)) && !this.sessions.get(id)?.sleep) return;
		const active = this.sessions.get(id);
		if (active && data.length) {
			active.inputDirty = true;
			if ((String(data).match(/\r/g)?.length ?? 0) > 1) active.ambiguousInput = true;
			active.inputVersion += data.length;
			if (String(data).endsWith("\r")) recordSubmission(active);
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
		if (
			!session ||
			!state ||
			![state.provider, state.providerSessionId, state.turnId].every(
				(value) => typeof value === "string" && value.length > 0 && value.length <= 256
			)
		)
			return;
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
			const argv = session.argvPrompt;
			if (
				argv &&
				(argv.provider !== state.provider ||
					argv.providerSessionId !== state.providerSessionId ||
					argv.hash !== state.promptHash)
			)
				return;
			const version =
				argv &&
				argv.provider === state.provider &&
				argv.providerSessionId === state.providerSessionId &&
				argv.hash === state.promptHash
					? argv.version
					: session.submittedVersions.shift();
			if (argv) session.argvPrompt = undefined;
			session.prompt = identity && version !== undefined ? { key, version, identity } : undefined;
			return;
		}
		if (state.phase !== "idle") return;
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
	registerLaunch(id: string, owner: QueueLaunchOwner, descriptor: QueueLaunchDescriptor): boolean {
		const session = this.sessions.get(id);
		const providerSessionId = owner.providerSessionId;
		if (
			!session ||
			!owner.entity ||
			owner.terminalId !== id ||
			!providerSessionId ||
			owner.provider !== descriptor.provider ||
			!validQueueLaunch(descriptor)
		)
			return false;
		const identity = session.inspect?.();
		if (!identity || !this.providerIdentity(identity, descriptor.provider)) return false;
		if (
			session.launch &&
			session.launch.providerSessionId === providerSessionId &&
			(JSON.stringify(session.launch.descriptor) !== JSON.stringify(descriptor) ||
				queueOwnerKey(session.launch.owner) !== queueOwnerKey(owner))
		)
			return false;
		if (
			session.launch &&
			session.launch.providerSessionId === providerSessionId &&
			!this.launchIdentity(session, identity)
		)
			return false;
		let binaryStamp: string;
		try {
			binaryStamp = this.binaryStamp(identity.executable);
		} catch {
			return false;
		}
		session.launch = {
			descriptor: structuredClone(descriptor),
			providerSessionId,
			owner: structuredClone(owner),
			executable: identity.executable,
			identity,
			binaryStamp,
		};
		return true;
	}

	private binaryStamp(executable: string): string {
		const s = statSync(executable);
		return JSON.stringify([s.dev, s.ino, s.size, s.mtimeMs]);
	}
	private launchIdentity(session: Session, identity: TerminalProcessIdentity): boolean {
		const launch = session.launch;
		if (!launch) return false;
		if (launch.identity) return sameTerminalProcess(launch.identity, identity);
		if (launch.trustedPid !== identity.pid || launch.executable !== identity.executable)
			return false;
		launch.identity = identity;
		launch.trustedPid = undefined;
		return true;
	}
	trustedLaunchProcess(id: string, pid: number): void {
		const launch = this.sessions.get(id)?.launch;
		if (launch) {
			launch.identity = undefined;
			launch.trustedPid = pid;
		}
	}
	private providerIdentity(identity: TerminalProcessIdentity, provider: string): boolean {
		return provider === "claude"
			? name(identity.executable) === "claude" || nativeClaude(identity.executable)
			: provider === "codex" && name(identity.executable) === "codex";
	}
	prepareSleep(
		id: string,
		client: string,
		provider: string,
		providerSessionId: string
	): FileInputTarget | null {
		const session = this.sessions.get(id);
		const ready = this.conversationTarget(id, client, provider, providerSessionId, false);
		if (
			!session?.launch ||
			session.launch.providerSessionId !== providerSessionId ||
			!ready?.supported
		)
			return null;
		const identity = session.inspect?.();
		if (!identity || !this.launchIdentity(session, identity)) return null;
		const generation = randomUUID();
		session.sleep = {
			generation,
			provider,
			providerSessionId,
			version: session.inputVersion,
			runningIdentity: identity,
		};
		return { generation, supported: true, foreground: ready.foreground };
	}
	canPark(id: string, generation: string): boolean {
		const s = this.sessions.get(id);
		const p = s?.sleep;
		const current = s?.inspect?.();
		return (
			!!s &&
			!!p &&
			p.generation === generation &&
			p.version === s.inputVersion &&
			!!current &&
			sameTerminalProcess(p.runningIdentity, current)
		);
	}
	completeSleep(id: string, generation: string, rootPid: number): boolean {
		const session = this.sessions.get(id);
		const proof = session?.sleep;
		const identity = session?.inspect?.();
		if (
			!session ||
			!proof ||
			proof.generation !== generation ||
			proof.version !== session.inputVersion ||
			!identity ||
			identity.pid !== rootPid ||
			!POSIX.has(name(identity.executable))
		)
			return false;
		proof.identity = identity;
		session.readyKey = undefined;
		session.prompt = undefined;
		session.inputDirty = true;
		return true;
	}
	replaceTransport(
		id: string,
		foreground: () => string,
		write: (data: string) => void,
		inspect: () => TerminalProcessIdentity | null
	): void {
		const s = this.sessions.get(id);
		if (!s) return;
		s.foreground = foreground;
		s.write = write;
		s.inspect = inspect;
		s.readyKey = undefined;
		s.prompt = undefined;
		s.argvPrompt = undefined;
		for (const client of s.clients.keys()) s.clients.set(client, null);
	}
	resumeTarget(
		id: string,
		client: string,
		provider: string,
		providerSessionId: string,
		reserve = true
	): FileInputTarget | null {
		const s = this.sessions.get(id);
		const proof = s?.sleep;
		const identity = s?.inspect?.();
		if (!s || !s.clients.has(client)) return { generation: "", foreground: "", supported: false };
		if (!s.launch) return null;
		const target = {
			generation: randomUUID(),
			foreground: identity?.name ?? "",
			supported:
				!!s.launch &&
				s.launch.providerSessionId === providerSessionId &&
				s.launch.descriptor.provider === provider &&
				!!proof?.identity &&
				proof.provider === provider &&
				proof.providerSessionId === providerSessionId &&
				proof.version === s.inputVersion &&
				!!identity &&
				sameTerminalProcess(proof.identity, identity),
		};
		if (reserve)
			s.clients.set(client, { ...target, identity: identity ?? undefined, resume: true });
		return target;
	}
	takeResume(
		id: string,
		client: string,
		generation: string,
		prompt: string | undefined,
		owner: QueueLaunchOwner
	): { executable: string; args: string[]; provider: string; providerSessionId: string } | null {
		const s = this.sessions.get(id);
		const lease = s?.clients.get(client);
		const proof = s?.sleep;
		const identity = s?.inspect?.();
		if (
			!s ||
			!lease?.resume ||
			lease.generation !== generation ||
			!lease.supported ||
			!s.launch ||
			queueOwnerKey(s.launch.owner) !== queueOwnerKey(owner) ||
			!proof?.identity ||
			proof.version !== s.inputVersion ||
			!identity ||
			!sameTerminalProcess(proof.identity, identity)
		)
			return null;
		for (const owner of s.clients.keys()) s.clients.set(owner, null);
		try {
			if (this.binaryStamp(s.launch.executable) !== s.launch.binaryStamp) return null;
		} catch {
			return null;
		}
		const args = queueResumeArgs(s.launch.descriptor, s.launch.providerSessionId, prompt);
		return {
			executable: s.launch.executable,
			args,
			provider: s.launch.descriptor.provider,
			providerSessionId: s.launch.providerSessionId,
		};
	}
	admittedArgvPrompt(
		id: string,
		provider: string,
		providerSessionId: string,
		prompt: string | undefined
	): void {
		const s = this.sessions.get(id);
		if (!s) return;
		s.sleep = undefined;
		s.submittedVersions = [];
		s.ambiguousInput = false;
		s.inputDirty = true;
		s.argvPrompt =
			prompt === undefined
				? undefined
				: {
						provider,
						providerSessionId,
						hash: createHash("sha256").update(prompt).digest("hex"),
						version: s.inputVersion,
					};
	}

	/** No shell/runtime heuristics: require OS-inspected native provider identity. */
	conversationTarget(
		id: string,
		client: string,
		provider: string,
		providerSessionId: string,
		reserve = true
	): FileInputTarget | null {
		const session = this.sessions.get(id);
		if (!session?.clients.has(client)) return null;
		const identity = session.inspect?.();
		const target = {
			generation: randomUUID(),
			foreground: identity?.name ?? "",
			supported:
				!session.inputDirty &&
				!session.ambiguousInput &&
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
		if (reserve)
			session.clients.set(client, {
				...target,
				identity: identity ?? undefined,
				conversation: true,
			});
		return target;
	}
	insertConversation(
		id: string,
		client: string,
		generation: string,
		text: string,
		answer = false
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
			/^[!/]/.test(text.trimStart()) ||
			(answer ? !answerContinuationFits(text) : text.length > QUEUE_REPLY_MAX_CHARACTERS) ||
			Buffer.byteLength(text) > (answer ? 56000 : 16000) ||
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
			recordSubmission(session);
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
		if (
			!session ||
			!target ||
			target.conversation ||
			target.resume ||
			target.generation !== generation
		)
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
			if (submit) recordSubmission(session);
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
