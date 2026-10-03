import {
	FILE_DROP_MAX_ITEMS,
	type FileDelivery,
	type TerminalFileBatch,
	type TerminalFileDraft,
	type TerminalFileTarget,
	fileInputProblem,
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
	) => Promise<{ text: string; target: TerminalFileTarget; submit?: boolean }>;
	insert: (
		batchId: string,
		text: string,
		payload: string,
		submit?: boolean
	) => Promise<FileDelivery>;
	copy: (batchId: string, id: string) => Promise<TerminalFileBatch>;
	copyPaths: (batchId: string, ids: string[]) => Promise<string>;
	clipboard: (text: string) => Promise<void>;
	cancel: (batchId: string) => Promise<unknown>;
	ready: () => boolean;
	paste: (text: string) => string;
	focus: () => void;
}
export class TerminalFileController {
	state: FileShelfState = { batch: null, busy: false, status: "" };
	private epoch = 0;
	private needsPreparation = false;
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
		if (this.state.batch?.id) void this.operations.cancel(this.state.batch.id).catch(() => {});
		this.needsPreparation = false;
		this.update({ batch: null, busy: false, status });
	}
	restore(draft: TerminalFileDraft): void {
		this.needsPreparation = true;
		this.update({
			batch: {
				id: "",
				target: { ...draft.target, generation: "" },
				entries: draft.entries.map((entry, index) => ({ ...entry, id: `restored-${index}` })),
			},
			busy: false,
			status: "Files restored. Review the prompt before sending.",
		});
	}
	suspend(status?: string): void {
		const batch = this.state.batch;
		this.epoch++;
		this.staging = null;
		this.pendingPaths = 0;
		this.activity = null;
		if (batch?.id) void this.operations.cancel(batch.id).catch(() => {});
		this.needsPreparation = Boolean(batch);
		this.update({
			batch: batch ? { ...batch, id: "", target: { ...batch.target, generation: "" } } : null,
			busy: false,
			status: batch
				? (status ??
					(fileInputProblem(batch.inputAvailability) ||
						"Files kept. Review the prompt before sending."))
				: "",
		});
	}
	focusInput(): void {
		if (this.operations.ready()) this.operations.focus();
	}
	private async prepareRestored(epoch: number): Promise<TerminalFileBatch | null> {
		const previous = this.state.batch;
		if (!previous || !this.needsPreparation) return previous;
		const fresh = await this.operations.prepare(previous.entries.map((entry) => entry.path));
		if (!this.current(epoch)) {
			void this.operations.cancel(fresh.id).catch(() => {});
			return null;
		}
		try {
			if (
				fresh.target.terminalId !== previous.target.terminalId ||
				fresh.target.workspaceId !== previous.target.workspaceId ||
				fresh.target.root !== previous.target.root ||
				(previous.target.rootIdentity && fresh.target.rootIdentity !== previous.target.rootIdentity)
			)
				throw new Error("The workspace changed. Remove these files and add them again.");
			for (let index = 0; index < previous.entries.length; index++) {
				const old = previous.entries[index];
				const entry = fresh.entries[index];
				if (
					!old ||
					!entry ||
					(old.identity && entry.identity !== old.identity) ||
					(old.path && entry.path && entry.path !== old.path)
				)
					throw new Error("A selected file changed or is missing. Remove it and add it again.");
				// Keep the reviewed copy's original display label; authority remains with fresh metadata.
				if (old.copyId && old.path === entry.path)
					fresh.entries[index] = {
						...entry,
						label: old.label,
						copyId: old.copyId,
						copyAllowed: false,
					};
				else if (!old.referenceAllowed && old.copyAllowed)
					fresh.entries[index] = { ...entry, referenceAllowed: false };
			}
			this.needsPreparation = false;
			this.update({ batch: fresh });
			return fresh;
		} catch (error) {
			void this.operations.cancel(fresh.id).catch(() => {});
			throw error;
		}
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
				const existing = this.needsPreparation
					? await this.prepareRestored(epoch)
					: this.state.batch;
				if (!this.current(epoch)) return;
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
				this.update({
					batch,
					status:
						fileInputProblem(batch.inputAvailability) ||
						"Files will be included when you press Enter.",
				});
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
		let selectedId = id;
		let batch = this.state.batch;
		if (!batch || this.state.busy || !this.operations.ready()) return;
		const epoch = this.epoch;
		this.activity = "copy";
		this.update({ busy: true, status: "Copying into workspace… Cancel stops this operation." });
		try {
			const index = batch.entries.findIndex((entry) => entry.id === id);
			const prepared = this.needsPreparation ? await this.prepareRestored(epoch) : this.state.batch;
			if (!prepared || !this.current(epoch)) return;
			batch = prepared;
			selectedId = batch.entries[index]?.id ?? id;
			const copied = await this.operations.copy(batch.id, selectedId);
			if (this.current(epoch)) {
				const selected = new Set(batch.entries.map((entry) => entry.id));
				this.update({
					batch: { ...copied, entries: copied.entries.filter((entry) => selected.has(entry.id)) },
					busy: false,
					status:
						fileInputProblem(copied.inputAvailability) ||
						"Workspace copy ready. Press Enter to include it with your message.",
				});
			}
		} catch (error) {
			if (this.current(epoch))
				this.update({
					busy: false,
					batch: {
						...batch,
						entries: batch.entries.map((entry) =>
							entry.id === selectedId ? { ...entry, referenceAllowed: false } : entry
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
	async copyPaths(): Promise<void> {
		if (!this.state.batch || this.state.busy || !this.operations.ready()) return;
		const epoch = this.epoch;
		this.activity = "copy";
		this.update({ busy: true, status: "Checking paths for the clipboard…" });
		try {
			const batch = this.needsPreparation ? await this.prepareRestored(epoch) : this.state.batch;
			if (!batch || !this.current(epoch)) return;
			if (batch.entries.some((entry) => !entry.referenceAllowed))
				throw new Error(
					"Remove files that need attention, or rename their paths and add them again."
				);
			const text = await this.operations.copyPaths(
				batch.id,
				batch.entries.map((entry) => entry.id)
			);
			if (!this.current(epoch)) return;
			await this.operations.clipboard(text);
			if (!this.current(epoch)) return;
			// Remove the app's send intent so the user's subsequent paste/Enter cannot duplicate paths.
			this.clear("Paths copied. Paste into the prompt, then press Enter. Nothing has been sent.");
			this.operations.focus();
		} catch (error) {
			if (this.current(epoch))
				this.reportError(
					error instanceof Error ? error.message : "Clipboard unavailable. Files kept."
				);
		} finally {
			if (this.epoch === epoch) {
				this.activity = null;
				this.update({ busy: false });
			}
		}
	}
	async insert(submit = false): Promise<void> {
		let batch = this.state.batch;
		if (!batch || this.state.busy || !this.operations.ready()) return;
		const epoch = this.epoch;
		this.activity = "insert";
		this.update({ busy: true, status: "Checking this terminal and the selected paths…" });
		let consumed = false;
		try {
			const refreshed = this.needsPreparation
				? await this.prepareRestored(epoch)
				: this.state.batch;
			if (!refreshed || !this.current(epoch)) return;
			batch = refreshed;
			if (batch.entries.some((entry) => !entry.referenceAllowed))
				throw new Error(
					"Review the files that need attention: remove them, or rename their paths and add them again."
				);
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
			if (delivery === "rejected") {
				this.update({ batch });
				this.suspend(
					"Nothing was sent. Files are kept; check this terminal and press Enter to try again."
				);
				return;
			}
			if (delivery === "admitted") this.operations.focus();
			this.update({
				busy: false,
				status:
					delivery === "admitted"
						? submit
							? prepared.submit !== true
								? "Files added to your prompt. Press Enter again to send with this terminal service."
								: "File paths sent with your message."
							: "Paths added to your prompt. Press Enter to send."
						: "Delivery uncertain — check the terminal. This batch will not be retried.",
			});
		} catch (error) {
			if (this.current(epoch)) {
				if (consumed)
					this.update({
						busy: false,
						status: "Delivery uncertain — check the terminal. This batch will not be retried.",
					});
				else this.suspend(error instanceof Error ? error.message : "Unable to prepare insertion.");
			}
		} finally {
			if (this.epoch === epoch) this.activity = null;
		}
	}
}
