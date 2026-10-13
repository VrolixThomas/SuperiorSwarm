import { isBinaryInput } from "../../shared/terminal-input";

interface InputDaemon {
	readonly isConnected: boolean;
	write(id: string, data: string): boolean;
	writeBinary(id: string, data: string): boolean;
	setInputPending?(id: string, pending: boolean): void;
}
interface InputIPC {
	handle(
		channel: string,
		callback: (event: unknown, id: unknown, data: unknown) => Promise<boolean>
	): unknown;
}
// Bound each terminal independently so a blocked wake cannot consume another
// terminal's input allowance. Also bound the number of pending terminals.
const MAX_PENDING_BYTES = 512_000;
const MAX_PENDING_WRITES = 1_024;
const MAX_PENDING_SESSIONS = 64;

export function registerTerminalInputIPC(
	ipc: InputIPC,
	daemon: InputDaemon,
	beforeInput?: (id: string) => Promise<void>,
	onAcceptedInput?: (id: string, data: string, binary: boolean) => void
) {
	const sessions = new Map<
		string,
		{ tail: Promise<unknown>; cancel: Set<() => void>; bytes: number; writes: number }
	>();
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
		let session = sessions.get(id);
		// One oversized paste may enter an otherwise idle queue; other terminals
		// still admit ordinary input while that paste waits for its agent.
		if (
			(session &&
				(session.bytes + bytes > MAX_PENDING_BYTES || session.writes >= MAX_PENDING_WRITES)) ||
			(!session && sessions.size >= MAX_PENDING_SESSIONS) ||
			(bytes > MAX_PENDING_BYTES && pendingWrites > 0)
		)
			return false;
		// Invalidate pending file intents before any asynchronous wake/queue work.
		onAcceptedInput?.(id, data, binary);
		pendingBytes += bytes;
		pendingWrites++;
		if (!session) {
			session = { tail: Promise.resolve(), cancel: new Set(), bytes: 0, writes: 0 };
			sessions.set(id, session);
			daemon.setInputPending?.(id, true);
		}
		session.bytes += bytes;
		session.writes++;
		const current = session;
		// Cancellation settles IPC and releases both the budget and retained
		// payload now, even when an older wake promise has not completed.
		let payload: string | undefined = data;
		return new Promise<boolean>((resolve, reject) => {
			let settled = false;
			const finish = (accepted: boolean, error?: unknown) => {
				if (settled) return;
				settled = true;
				payload = undefined;
				current.cancel.delete(cancel);
				pendingBytes -= bytes;
				pendingWrites--;
				current.bytes -= bytes;
				current.writes--;
				if (sessions.get(id) === current && current.cancel.size === 0) {
					sessions.delete(id);
					daemon.setInputPending?.(id, false);
				}
				if (error !== undefined) reject(error);
				else resolve(accepted);
			};
			const cancel = () => finish(false);
			current.cancel.add(cancel);
			const task = current.tail.then(async () => {
				if (sessions.get(id) !== current || settled) return false;
				await beforeInput?.(id);
				if (sessions.get(id) !== current || payload === undefined || !daemon.isConnected)
					return false;
				return binary ? daemon.writeBinary(id, payload) : daemon.write(id, payload);
			});
			current.tail = task.then(
				(accepted) => finish(accepted),
				(error) => finish(false, error)
			);
		});
	}
	const invalidate = (id: string) => {
		const session = sessions.get(id);
		sessions.delete(id);
		if (session) for (const cancel of session.cancel) cancel();
		daemon.setInputPending?.(id, false);
	};

	ipc.handle("terminal:write", (_event, id, data) => write(id, data, false));
	ipc.handle("terminal:write-binary", (_event, id, data) => write(id, data, true));
	return {
		invalidate,
		clear: () => {
			for (const id of sessions.keys()) invalidate(id);
		},
		diagnostics: () => ({ pendingBytes, pendingWrites, sessions: sessions.size }),
	};
}
