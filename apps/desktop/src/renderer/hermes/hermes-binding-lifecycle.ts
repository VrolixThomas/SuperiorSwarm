export interface HermesRendererBinding {
	connectionId: string;
	hermesSessionId: string;
	claimId: string;
	runtimeSessionId: string;
}

export class HermesBindingLifecycle {
	private selectionKey = "";
	private binding: HermesRendererBinding | null = null;
	private disposed = false;

	constructor(private readonly release: (binding: HermesRendererBinding) => void) {}

	select(selectionKey: string): void {
		this.selectionKey = selectionKey;
	}

	activate(): void {
		this.disposed = false;
	}

	releaseObsolete(): void {
		const binding = this.binding;
		if (!binding) return;
		const bindingKey = `${binding.connectionId}:${binding.hermesSessionId}`;
		if (bindingKey === this.selectionKey) return;
		this.binding = null;
		this.release(binding);
	}

	accept(selectionKey: string, binding: HermesRendererBinding): boolean {
		if (this.disposed || selectionKey !== this.selectionKey) {
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
