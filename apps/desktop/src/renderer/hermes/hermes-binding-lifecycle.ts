export interface HermesSelectionGeneration {
	key: string;
	generation: number;
}

export function settleHermesSelectionAttachments<T extends { handle: string }>(
	guard: HermesSelectionGuard,
	selection: HermesSelectionGeneration,
	attachments: T[],
	callbacks: {
		accept: (attachments: T[]) => void;
		release: (attachment: T) => void;
	}
): boolean {
	if (guard.runIfCurrent(selection, () => callbacks.accept(attachments))) return true;
	for (const attachment of attachments) callbacks.release(attachment);
	return false;
}

/** Guards renderer async callbacks only; it does not own or release Hermes sessions. */
export class HermesSelectionGuard {
	private selection: HermesSelectionGeneration = { key: "", generation: 0 };
	private disposed = false;

	select(selectionKey: string): HermesSelectionGeneration {
		if (selectionKey !== this.selection.key) {
			this.selection = {
				key: selectionKey,
				generation: this.selection.generation + 1,
			};
		}
		return this.selection;
	}

	activate(): void {
		this.disposed = false;
	}

	isCurrent(selection: HermesSelectionGeneration): boolean {
		return (
			!this.disposed &&
			selection.key === this.selection.key &&
			selection.generation === this.selection.generation
		);
	}

	runIfCurrent(selection: HermesSelectionGeneration, callback: () => void): boolean {
		if (!this.isCurrent(selection)) return false;
		callback();
		return true;
	}

	dispose(): void {
		this.disposed = true;
	}
}
