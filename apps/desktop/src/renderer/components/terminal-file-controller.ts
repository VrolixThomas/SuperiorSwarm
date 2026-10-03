import {
	FILE_DROP_MAX_ITEMS,
	type FileDelivery,
	type TerminalFileBatch,
	type TerminalFileTarget,
} from "../../shared/terminal-files";
export interface FileShelfState {
	batch: TerminalFileBatch | null;
	busy: boolean;
	status: string;
}
interface Operations {
	prepare: (paths: Array<string | null>) => Promise<TerminalFileBatch>;
	append: (
		batchId: string,
		paths: Array<string | null>,
		retainedIds: string[]
	) => Promise<TerminalFileBatch>;
	resolve: (
		batchId: string,
		ids: string[],
		submit?: boolean
	) => Promise<{ text: string; target: TerminalFileTarget }>;
	insert: (
		batchId: string,
		text: string,
		payload: string,
		submit?: boolean
	) => Promise<FileDelivery>;
	copy: (batchId: string, id: string) => Promise<TerminalFileBatch>;
	cancel: (batchId: string) => Promise<unknown>;
	ready: () => boolean;
	paste: (text: string) => string;
	focus: () => void;
}
export class TerminalFileController {
	state: FileShelfState = { batch: null, busy: false, status: "" };
	private epoch = 0;
	private staging: Promise<void> | null = null;
	private pendingPaths = 0;
	private activity: "stage" | "copy" | "insert" | null = null;
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
		this.staging = null;
		this.pendingPaths = 0;
		this.activity = null;
		if (this.state.batch) void this.operations.cancel(this.state.batch.id).catch(() => {});
		this.update({ batch: null, busy: false, status });
	}
	reportError(status: string): void {
		this.update({ status });
	}
	hasFilesForSubmit(): boolean {
		return this.state.batch !== null || this.state.busy;
	}
	stage(paths: Array<string | null>): Promise<void> {
		if (!paths.length) return Promise.resolve();
		if (!this.operations.ready()) {
			this.reportError(
				"Bring this terminal into view and wait for replay to finish, then add files again."
			);
			return Promise.resolve();
		}
		if (this.activity === "copy" || this.activity === "insert") {
			this.reportError("Wait for the current file operation to finish, then add more files.");
			return Promise.resolve();
		}
		if (
			(this.state.batch?.entries.length ?? 0) + this.pendingPaths + paths.length >
			FILE_DROP_MAX_ITEMS
		) {
			this.reportError("Choose at most 64 files in total. Earlier files are still selected.");
			return Promise.resolve();
		}
		const epoch = this.epoch;
		const previous = this.staging;
		this.pendingPaths += paths.length;
		this.activity = "stage";
		this.update({ busy: true, status: "Adding files…" });
		const run = async () => {
			if (!this.current(epoch)) return;
			try {
				const existing = this.state.batch;
				const batch = existing
					? await this.operations.append(
							existing.id,
							paths,
							existing.entries.map((entry) => entry.id)
						)
					: await this.operations.prepare(paths);
				if (!this.current(epoch)) {
					void this.operations.cancel(batch.id).catch(() => {});
					return;
				}
				this.update({ batch, status: "Files will be included when you press Enter." });
			} catch (error) {
				if (this.current(epoch))
					this.reportError(
						error instanceof Error
							? error.message
							: "Unable to add files. Earlier files are still selected."
					);
			} finally {
				if (this.epoch === epoch) {
					this.pendingPaths -= paths.length;
					if (this.pendingPaths === 0) {
						this.activity = null;
						this.update({ busy: false });
					}
				}
			}
		};
		const next = previous ? previous.then(run) : run();
		this.staging = next;
		void next.then(() => {
			if (this.staging === next) this.staging = null;
		});
		return next;
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
		this.activity = "copy";
		this.update({ busy: true, status: "Copying into workspace… Cancel stops this operation." });
		try {
			const copied = await this.operations.copy(batch.id, id);
			if (this.current(epoch)) {
				const selected = new Set(batch.entries.map((entry) => entry.id));
				this.update({
					batch: { ...copied, entries: copied.entries.filter((entry) => selected.has(entry.id)) },
					busy: false,
					status: "Workspace copy ready. Press Enter to include it with your message.",
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
		} finally {
			if (this.epoch === epoch) this.activity = null;
		}
	}
	async submit(): Promise<void> {
		if (this.state.busy) {
			this.reportError("Files are still being prepared. Press Enter again when they are ready.");
			return;
		}
		await this.insert(true);
	}
	async insert(submit = false): Promise<void> {
		const batch = this.state.batch;
		if (!batch || this.state.busy || !this.operations.ready()) return;
		const epoch = this.epoch;
		this.activity = "insert";
		this.update({ busy: true, status: "Checking this terminal and the selected paths…" });
		let consumed = false;
		try {
			const ids = batch.entries.map((entry) => entry.id);
			const prepared = submit
				? await this.operations.resolve(batch.id, ids, true)
				: await this.operations.resolve(batch.id, ids);
			if (!this.current(epoch)) return;
			consumed = true;
			this.update({ batch: null });
			const payload = this.operations.paste(prepared.text);
			const delivery = await this.operations.insert(batch.id, prepared.text, payload, submit);
			if (!this.current(epoch)) return;
			if (delivery === "admitted") this.operations.focus();
			this.update({
				busy: false,
				status:
					delivery === "admitted"
						? submit
							? "File paths sent with your message."
							: "Paths added to your prompt. Press Enter to send."
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
		} finally {
			if (this.epoch === epoch) this.activity = null;
		}
	}
}
