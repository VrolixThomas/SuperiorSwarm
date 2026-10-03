import type {
	FileDelivery,
	TerminalFileBatch,
	TerminalFileTarget,
} from "../../shared/terminal-files";
export interface FileShelfState {
	batch: TerminalFileBatch | null;
	busy: boolean;
	status: string;
}
interface Operations {
	prepare: (paths: Array<string | null>) => Promise<TerminalFileBatch>;
	resolve: (
		batchId: string,
		ids: string[]
	) => Promise<{ text: string; target: TerminalFileTarget }>;
	insert: (batchId: string, text: string, payload: string) => Promise<FileDelivery>;
	copy: (batchId: string, id: string) => Promise<TerminalFileBatch>;
	cancel: (batchId: string) => Promise<unknown>;
	ready: () => boolean;
	paste: (text: string) => string;
	focus: () => void;
}
export class TerminalFileController {
	state: FileShelfState = { batch: null, busy: false, status: "" };
	private epoch = 0;
	constructor(
		private operations: Operations,
		private changed: (state: FileShelfState) => void
	) {}
	private update(state: Partial<FileShelfState>): void {
		this.state = { ...this.state, ...state };
		this.changed(this.state);
	}
	private current(epoch: number): boolean {
		return epoch === this.epoch && this.operations.ready();
	}
	clear(status = ""): void {
		this.epoch++;
		if (this.state.batch) void this.operations.cancel(this.state.batch.id).catch(() => {});
		this.update({ batch: null, busy: false, status });
	}
	async stage(paths: Array<string | null>): Promise<void> {
		this.clear();
		if (!paths.length) return;
		if (!this.operations.ready()) {
			this.update({
				status: "Bring this terminal into view and wait for replay to finish, then drop again.",
			});
			return;
		}
		const epoch = this.epoch;
		this.update({ busy: true, status: "Resolving local file references…" });
		try {
			const batch = await this.operations.prepare(paths);
			if (!this.current(epoch)) {
				void this.operations.cancel(batch.id).catch(() => {});
				return;
			}
			this.update({
				batch,
				busy: false,
				status: "Review paths before inserting. Nothing has been sent.",
			});
		} catch (error) {
			if (this.current(epoch))
				this.update({
					busy: false,
					status: error instanceof Error ? error.message : "Unable to resolve files.",
				});
		}
	}
	remove(id: string): void {
		if (!this.state.batch || this.state.busy) return;
		const entries = this.state.batch.entries.filter((entry) => entry.id !== id);
		if (!entries.length) this.clear();
		else this.update({ batch: { ...this.state.batch, entries } });
	}
	async copy(id: string): Promise<void> {
		const batch = this.state.batch;
		if (!batch || this.state.busy || !this.operations.ready()) return;
		const epoch = this.epoch;
		this.update({ busy: true, status: "Copying into workspace… Cancel stops this operation." });
		try {
			const copied = await this.operations.copy(batch.id, id);
			if (this.current(epoch)) {
				const selected = new Set(batch.entries.map((entry) => entry.id));
				this.update({
					batch: { ...copied, entries: copied.entries.filter((entry) => selected.has(entry.id)) },
					busy: false,
					status:
						"Copy retained in workspace. Access is still unverified. Choose Insert paths when ready.",
				});
			}
		} catch (error) {
			if (this.current(epoch))
				this.update({
					busy: false,
					batch: {
						...batch,
						entries: batch.entries.map((entry) =>
							entry.id === id ? { ...entry, referenceAllowed: false } : entry
						),
					},
					status:
						error instanceof Error
							? error.message
							: "Copy failed. Remove the file or retry copying explicitly.",
				});
		}
	}
	async insert(): Promise<void> {
		const batch = this.state.batch;
		if (!batch || this.state.busy || !this.operations.ready()) return;
		const epoch = this.epoch;
		this.update({ busy: true, status: "Checking this terminal and the selected paths…" });
		let consumed = false;
		try {
			const prepared = await this.operations.resolve(
				batch.id,
				batch.entries.map((entry) => entry.id)
			);
			if (!this.current(epoch)) return;
			consumed = true;
			this.update({ batch: null });
			const payload = this.operations.paste(prepared.text);
			const delivery = await this.operations.insert(batch.id, prepared.text, payload);
			if (!this.current(epoch)) return;
			if (delivery === "admitted") this.operations.focus();
			this.update({
				busy: false,
				status:
					delivery === "admitted"
						? "Paths inserted. Review the current input and press Enter yourself to send."
						: delivery === "rejected"
							? "Nothing inserted: terminal changed or unavailable. Drop again when ready."
							: "Delivery uncertain — check the terminal. This batch will not be retried.",
			});
		} catch (error) {
			if (this.current(epoch))
				this.update({
					busy: false,
					status: consumed
						? "Delivery uncertain — check the terminal. This batch will not be retried."
						: error instanceof Error
							? error.message
							: "Unable to prepare insertion.",
				});
		}
	}
}
