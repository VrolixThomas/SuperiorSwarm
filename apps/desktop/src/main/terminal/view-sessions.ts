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
type Batch = { chunks: string[]; chars: number };
const MAX_PENDING_CHARS = 4_000_000;

interface LegacySession {
	id: string;
	cols: number;
	rows: number;
	recovery?: TerminalDataMeta["recovery"];
	batch?: Batch;
	batches: Set<Batch>;
	pendingChars: number;
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
			existing.batch = undefined;
			const version = ++existing.version;
			await this.enqueue(existing, async () => {
				if (existing.version !== version) return;
				existing.viewer = { onData, onExit };
				const data = existing.replay.snapshot();
				if (data || existing.recovery) onData(data, { replay: true, recovery: existing.recovery });
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
			entry.batch = undefined;
			void this.enqueue(
				entry,
				() =>
					new Promise<void>((resolve) => {
						entry.cols = cols;
						entry.rows = rows;
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
			id,
			cols: 80,
			rows: 24,
			batches: new Set(),
			pendingChars: 0,
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
			this.fail(entry);
		});
		return work;
	}

	private receive(entry: LegacySession, data: string, meta?: TerminalDataMeta): void {
		if (entry.stopped) return;
		if (this.daemon.supportsTerminalSnapshots) {
			entry.batch = undefined;
			void this.enqueue(entry, async () => {
				entry.viewer?.onData(data, meta);
			});
			return;
		}
		if (entry.pendingChars + data.length > MAX_PENDING_CHARS) {
			this.fail(entry);
			return;
		}
		entry.pendingChars += data.length;
		// A replay is a new baseline, never an incremental part of the old
		// stream. Old daemons cannot prove what was missed while disconnected.
		if (meta?.replay) {
			entry.batch = undefined;
			void this.enqueue(entry, async () => {
				entry.replay.dispose();
				entry.replay = new TerminalReplayBuffer();
				entry.replay.resize(entry.cols, entry.rows);
				entry.recovery = "legacy-replay";
				await new Promise<string>((resolve) => entry.replay.write(data, resolve));
				entry.pendingChars -= data.length;
				if (entry.stopped) return;
				if (isShellProcess(meta.fg))
					await new Promise<void>((resolve) => entry.replay.resetStaleModes(resolve));
				if (!entry.stopped)
					entry.viewer?.onData(entry.replay.snapshot(), { ...meta, recovery: entry.recovery });
			});
			return;
		}
		if (entry.batch) {
			entry.batch.chunks.push(data);
			entry.batch.chars += data.length;
			return;
		}
		const batch: Batch = { chunks: [data], chars: data.length };
		entry.batch = batch;
		entry.batches.add(batch);
		void this.enqueue(entry, async () => {
			if (entry.batch === batch) entry.batch = undefined;
			const joined = batch.chunks.join("");
			batch.chunks = [];
			const output = await new Promise<string>((resolve) => entry.replay.write(joined, resolve));
			entry.pendingChars -= batch.chars;
			entry.batches.delete(batch);
			if (!entry.stopped && output) entry.viewer?.onData(output);
		});
	}

	private fail(entry: LegacySession): void {
		if (entry.stopped) return;
		const viewer = entry.viewer;
		this.drop(entry.id);
		// The PTY stays alive; the view can explicitly reattach. Never allow an
		// unbounded parser queue or disguise discarded output as a healthy view.
		viewer?.onData("", { replay: true, recovery: "output-overflow" });
	}

	diagnostics(id: string) {
		const entry = this.legacy.get(id);
		return entry
			? { pendingChars: entry.pendingChars, recovery: entry.recovery, attached: !!entry.viewer }
			: null;
	}

	private exit(id: string, entry: LegacySession, code: number): void {
		entry.batch = undefined;
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
		entry.batch = undefined;
		for (const batch of entry.batches) batch.chunks = [];
		entry.batches.clear();
		entry.replay.dispose();
	}
}
