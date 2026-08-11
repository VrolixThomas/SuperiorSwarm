import type { HermesComposerDraftIdentity } from "../../shared/hermes";

export type HermesComposerDraftSubmissionDisposition = "submitted" | "queued" | "failed";

export interface HermesComposerDraftSubmission {
	text: string;
	revision: number;
}

export interface HermesComposerDraftRemote {
	load(identity: HermesComposerDraftIdentity): Promise<string>;
	save(identity: HermesComposerDraftIdentity, text: string): Promise<void>;
}

interface PendingWrite {
	sequence: number;
	text: string;
}

interface DraftEntry {
	identity: HermesComposerDraftIdentity;
	text: string;
	hasValue: boolean;
	loadStarted: boolean;
	revision: number;
	listeners: Set<(text: string) => void>;
	debounceTimer: ReturnType<typeof setTimeout> | null;
	retryTimer: ReturnType<typeof setTimeout> | null;
	nextWriteSequence: number;
	pendingWrite: PendingWrite | null;
	writing: boolean;
	lastPersistedText: string | null;
}

export function hermesComposerDraftIdentityKey(identity: HermesComposerDraftIdentity): string {
	return JSON.stringify([
		identity.managerId,
		identity.projectId,
		identity.connectionId,
		identity.profileId,
		identity.durableSessionId,
	]);
}

export function hermesComposerDraftAfterSubmit(input: {
	currentText: string;
	currentRevision: number;
	submittedText: string;
	submittedRevision: number;
	disposition: HermesComposerDraftSubmissionDisposition;
}): string {
	return input.disposition === "submitted" &&
		input.currentText === input.submittedText &&
		input.currentRevision === input.submittedRevision
		? ""
		: input.currentText;
}

/**
 * Renderer-lifetime draft cache and serialized writer. Keeping it outside React component
 * lifetimes lets tab changes flush and remount without briefly restoring an older DB value.
 */
export class HermesComposerDraftCoordinator {
	private readonly entries = new Map<string, DraftEntry>();

	constructor(
		private readonly remote: HermesComposerDraftRemote,
		private readonly debounceMs = 200
	) {}

	subscribe(identity: HermesComposerDraftIdentity, listener: (text: string) => void): () => void {
		const entry = this.entry(identity);
		entry.listeners.add(listener);
		listener(entry.text);
		this.load(entry);
		return () => {
			entry.listeners.delete(listener);
			this.flush(identity);
		};
	}

	edit(identity: HermesComposerDraftIdentity, text: string): void {
		const entry = this.entry(identity);
		entry.text = text;
		entry.hasValue = true;
		entry.revision++;
		this.notify(entry);
		if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
		entry.debounceTimer = setTimeout(() => {
			entry.debounceTimer = null;
			this.enqueueCurrent(entry);
		}, this.debounceMs);
	}

	text(identity: HermesComposerDraftIdentity): string {
		return this.entries.get(hermesComposerDraftIdentityKey(identity))?.text ?? "";
	}

	captureSubmission(identity: HermesComposerDraftIdentity): HermesComposerDraftSubmission {
		const entry = this.entry(identity);
		return { text: entry.text, revision: entry.revision };
	}

	flush(identity: HermesComposerDraftIdentity): void {
		const entry = this.entries.get(hermesComposerDraftIdentityKey(identity));
		if (!entry || !entry.hasValue) return;
		if (entry.debounceTimer) {
			clearTimeout(entry.debounceTimer);
			entry.debounceTimer = null;
		}
		this.enqueueCurrent(entry);
	}

	flushAll(): void {
		for (const entry of this.entries.values()) this.flush(entry.identity);
	}

	settleSubmission(
		identity: HermesComposerDraftIdentity,
		submission: HermesComposerDraftSubmission,
		disposition: HermesComposerDraftSubmissionDisposition
	): void {
		const entry = this.entries.get(hermesComposerDraftIdentityKey(identity));
		if (!entry) return;
		const nextText = hermesComposerDraftAfterSubmit({
			currentText: entry.text,
			currentRevision: entry.revision,
			submittedText: submission.text,
			submittedRevision: submission.revision,
			disposition,
		});
		if (nextText === entry.text) return;
		if (entry.debounceTimer) {
			clearTimeout(entry.debounceTimer);
			entry.debounceTimer = null;
		}
		entry.text = nextText;
		entry.hasValue = true;
		entry.revision++;
		this.notify(entry);
		this.enqueueCurrent(entry);
	}

	private entry(identity: HermesComposerDraftIdentity): DraftEntry {
		const key = hermesComposerDraftIdentityKey(identity);
		const existing = this.entries.get(key);
		if (existing) return existing;
		const created: DraftEntry = {
			identity: { ...identity },
			text: "",
			hasValue: false,
			loadStarted: false,
			revision: 0,
			listeners: new Set(),
			debounceTimer: null,
			retryTimer: null,
			nextWriteSequence: 0,
			pendingWrite: null,
			writing: false,
			lastPersistedText: null,
		};
		this.entries.set(key, created);
		return created;
	}

	private load(entry: DraftEntry): void {
		if (entry.loadStarted || entry.hasValue) return;
		entry.loadStarted = true;
		const revision = entry.revision;
		void this.remote.load(entry.identity).then(
			(text) => {
				if (entry.revision !== revision || entry.hasValue) return;
				entry.lastPersistedText = text;
				entry.text = text;
				entry.hasValue = true;
				this.notify(entry);
			},
			() => {
				if (entry.revision !== revision || entry.hasValue) return;
				entry.hasValue = true;
			}
		);
	}

	private notify(entry: DraftEntry): void {
		for (const listener of entry.listeners) listener(entry.text);
	}

	private enqueueCurrent(entry: DraftEntry): void {
		if (entry.text === entry.lastPersistedText && entry.pendingWrite === null && !entry.writing) {
			return;
		}
		entry.pendingWrite = {
			sequence: ++entry.nextWriteSequence,
			text: entry.text,
		};
		this.drain(entry);
	}

	private drain(entry: DraftEntry): void {
		if (entry.writing || !entry.pendingWrite) return;
		if (entry.retryTimer) {
			clearTimeout(entry.retryTimer);
			entry.retryTimer = null;
		}
		const write = entry.pendingWrite;
		entry.pendingWrite = null;
		entry.writing = true;
		void this.remote.save(entry.identity, write.text).then(
			() => {
				entry.writing = false;
				entry.lastPersistedText = write.text;
				this.drain(entry);
			},
			() => {
				entry.writing = false;
				if (!entry.pendingWrite || entry.pendingWrite.sequence < write.sequence) {
					entry.pendingWrite = write;
				}
				entry.retryTimer = setTimeout(
					() => {
						entry.retryTimer = null;
						this.drain(entry);
					},
					Math.max(this.debounceMs, 1_000)
				);
			}
		);
	}
}
