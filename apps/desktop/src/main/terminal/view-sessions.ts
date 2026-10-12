import { TerminalReplayBuffer } from "../../daemon/terminal-replay-buffer";
import type { TerminalDataMeta } from "../../shared/daemon-protocol";
import { isShellProcess } from "../../shared/lib/terminal-modes";
import type { DaemonClient } from "./daemon-client";

type Transport = Pick<
	DaemonClient,
	"create" | "attach" | "detach" | "dispose" | "resize" | "supportsTerminalSnapshots"
>;
type Viewer = {
	onData: (data: string, meta?: TerminalDataMeta) => void;
	onExit: (code: number) => void;
};
interface LegacySession {
	replay: TerminalReplayBuffer;
	viewer?: Viewer;
	version: number;
	pending: Promise<void>;
	stopped: boolean;
}

// Old daemons survive app upgrades while they own live PTYs. Keep their stream
// attached in the main process when a renderer leaves a workspace, so returning
// can restore actual terminal state instead of a truncated raw-output suffix.
export class TerminalViewSessions {
	private legacy = new Map<string, LegacySession>();
	constructor(private daemon: Transport) {}

	async create(...args: Parameters<Transport["create"]>): Promise<void> {
		const [id, cwd, onData, onExit, env] = args;
		this.drop(id);
		if (this.daemon.supportsTerminalSnapshots) return this.daemon.create(...args);
		const entry = this.start(id, { onData, onExit });
		try {
			await this.daemon.create(
				id,
				cwd,
				(data, meta) => this.receive(entry, data, meta),
				(code) => this.exit(id, entry, code),
				env
			);
		} catch (error) {
			if (this.legacy.get(id) === entry) this.drop(id);
			throw error;
		}
	}

	async attach(...args: Parameters<Transport["attach"]>): Promise<void> {
		const [id, onData, onExit, cwd, env] = args;
		if (this.daemon.supportsTerminalSnapshots) {
			this.drop(id);
			return this.daemon.attach(...args);
		}
		const existing = this.legacy.get(id);
		if (existing) {
			existing.viewer = undefined;
			const version = ++existing.version;
			await this.enqueue(existing, async () => {
				if (existing.version !== version) return;
				existing.viewer = { onData, onExit };
				const data = existing.replay.snapshot();
				if (data) onData(data, { replay: true });
			});
			return;
		}
		const entry = this.start(id, { onData, onExit });
		try {
			await this.daemon.attach(
				id,
				(data, meta) => this.receive(entry, data, meta),
				(code) => this.exit(id, entry, code),
				cwd,
				env
			);
		} catch (error) {
			if (this.legacy.get(id) === entry) this.drop(id);
			throw error;
		}
	}

	detach(id: string): void {
		const entry = this.legacy.get(id);
		if (entry && !this.daemon.supportsTerminalSnapshots) {
			entry.viewer = undefined;
			entry.version++;
			return;
		}
		this.drop(id);
		this.daemon.detach(id);
	}

	resize(id: string, cols: number, rows: number): void {
		const entry = this.legacy.get(id);
		if (entry && !this.daemon.supportsTerminalSnapshots) {
			void this.enqueue(
				entry,
				() =>
					new Promise<void>((resolve) => {
						entry.replay.resize(cols, rows);
						entry.replay.afterWrites(resolve);
					})
			);
		}
		this.daemon.resize(id, cols, rows);
	}

	dispose(id: string): void {
		this.drop(id);
		this.daemon.dispose(id);
	}

	private start(id: string, viewer: Viewer): LegacySession {
		const entry: LegacySession = {
			replay: new TerminalReplayBuffer(),
			viewer,
			version: 0,
			pending: Promise.resolve(),
			stopped: false,
		};
		this.legacy.set(id, entry);
		return entry;
	}

	private enqueue(entry: LegacySession, operation: () => Promise<void>): Promise<void> {
		const work = entry.pending.then(() => (entry.stopped ? undefined : operation()));
		entry.pending = work.catch((error) => {
			console.error("[terminal-view-sessions] Failed to update terminal state:", error);
		});
		return work;
	}

	private receive(entry: LegacySession, data: string, meta?: TerminalDataMeta): void {
		void this.enqueue(entry, async () => {
			if (this.daemon.supportsTerminalSnapshots) {
				entry.viewer?.onData(data, meta);
				return;
			}
			const output = await new Promise<string>((resolve) => entry.replay.write(data, resolve));
			if (entry.stopped) return;
			if (meta?.replay && isShellProcess(meta.fg)) {
				await new Promise<void>((resolve) => entry.replay.resetStaleModes(resolve));
			}
			if (entry.stopped) return;
			if (meta?.replay) entry.viewer?.onData(entry.replay.snapshot(), meta);
			else if (output) entry.viewer?.onData(output);
		});
	}

	private exit(id: string, entry: LegacySession, code: number): void {
		void this.enqueue(entry, async () => {
			if (this.legacy.get(id) !== entry) return;
			try {
				entry.viewer?.onExit(code);
			} finally {
				this.drop(id);
			}
		});
	}

	private drop(id: string): void {
		const entry = this.legacy.get(id);
		if (!entry) return;
		this.legacy.delete(id);
		entry.stopped = true;
		entry.viewer = undefined;
		entry.replay.dispose();
	}
}
