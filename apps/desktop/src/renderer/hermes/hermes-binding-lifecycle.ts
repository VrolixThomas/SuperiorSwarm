export interface HermesRendererBinding {
	connectionId: string;
	hermesSessionId: string;
	claimId: string;
	runtimeSessionId: string;
}

export interface HermesSelectionGeneration {
	key: string;
	generation: number;
}

export class HermesBindingLifecycle {
	private selection: HermesSelectionGeneration = { key: "", generation: 0 };
	private binding: HermesRendererBinding | null = null;
	private disposed = false;

	constructor(private readonly release: (binding: HermesRendererBinding) => void) {}

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

	releaseObsolete(): void {
		const binding = this.binding;
		if (!binding) return;
		const bindingKey = `${binding.connectionId}:${binding.hermesSessionId}`;
		if (bindingKey === this.selection.key) return;
		this.binding = null;
		this.release(binding);
	}

	accept(selection: HermesSelectionGeneration, binding: HermesRendererBinding): boolean {
		if (!this.isCurrent(selection)) {
			this.release(binding);
			return false;
		}
		const previous = this.binding;
		this.binding = binding;
		if (
			previous &&
			previous.claimId !== binding.claimId &&
			(previous.connectionId !== binding.connectionId ||
				previous.hermesSessionId !== binding.hermesSessionId)
		) {
			this.release(previous);
		}
		return true;
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

	current(): HermesRendererBinding | null {
		return this.binding;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const binding = this.binding;
		this.binding = null;
		if (binding) this.release(binding);
	}
}
