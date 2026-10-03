import { isBinaryInput } from "../../shared/terminal-input";

interface InputDaemon {
	readonly isConnected: boolean;
	write(id: string, data: string): boolean;
	writeBinary(id: string, data: string): boolean;
}
interface InputIPC {
	handle(
		channel: string,
		callback: (event: unknown, id: unknown, data: unknown) => Promise<boolean>
	): unknown;
}
// Bound memory retained while an agent wakes. Text and binary share arrival
// order and a budget, but different terminals can wake independently.
const MAX_PENDING_BYTES = 512_000;
const MAX_PENDING_WRITES = 1_024;

export function registerTerminalInputIPC(
	ipc: InputIPC,
	daemon: InputDaemon,
	beforeInput?: (id: string) => Promise<void>
) {
	const sessions = new Map<string, { tail: Promise<unknown> }>();
	let pendingBytes = 0;
	let pendingWrites = 0;

	async function write(id: unknown, data: unknown, binary: boolean): Promise<boolean> {
		if (!daemon.isConnected) return false;
		if (binary) {
			if (!isBinaryInput(id, data)) return false;
		}
		if (typeof id !== "string" || !id.length) throw new Error("id must be a non-empty string");
		if (typeof data !== "string") throw new Error("data must be a string");
		const bytes = Buffer.byteLength(data, binary ? "latin1" : "utf8") + Buffer.byteLength(id);
		// Admit one idle paste at any size so DaemonClient can chunk it. Count
		// it against the budget while waking to bound additional queued input.
		if (
			(pendingWrites > 0 && pendingBytes + bytes > MAX_PENDING_BYTES) ||
			pendingWrites >= MAX_PENDING_WRITES
		)
			return false;
		pendingBytes += bytes;
		pendingWrites++;
		let session = sessions.get(id);
		if (!session) {
			session = { tail: Promise.resolve() };
			sessions.set(id, session);
		}
		const current = session;
		const task = current.tail.then(async () => {
			if (sessions.get(id) !== current) return false;
			await beforeInput?.(id);
			if (sessions.get(id) !== current) return false;
			return binary ? daemon.writeBinary(id, data) : daemon.write(id, data);
		});
		const tail = task.catch(() => {});
		current.tail = tail;
		try {
			return await task;
		} finally {
			pendingBytes -= bytes;
			pendingWrites--;
			if (sessions.get(id) === current && current.tail === tail) sessions.delete(id);
		}
	}
	ipc.handle("terminal:write", (_event, id, data) => write(id, data, false));
	ipc.handle("terminal:write-binary", (_event, id, data) => write(id, data, true));
	return {
		invalidate: (id: string) => {
			sessions.delete(id);
		},
		clear: () => {
			sessions.clear();
		},
	};
}
