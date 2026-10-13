// Snapshots are collected on demand only. No transcript or input contents.
const readers = new Map<string, () => Promise<unknown>>();
export function registerTerminalDiagnostics(id: string, read: () => Promise<unknown>): () => void {
	readers.set(id, read);
	return () => {
		if (readers.get(id) === read) readers.delete(id);
	};
}
export function readTerminalDiagnostics(id: string): Promise<unknown> {
	return readers.get(id)?.() ?? Promise.resolve(null);
}
