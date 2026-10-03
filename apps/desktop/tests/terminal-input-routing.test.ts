import { describe, expect, test } from "bun:test";
import { registerTerminalInputIPC } from "../src/main/terminal/input-ipc";
import { createTerminalInputAPI } from "../src/preload/terminal-input";
import { installTerminalInput } from "../src/renderer/components/terminal-input";

function harness() {
	const listeners = {
		text: new Set<(s: string) => void>(),
		binary: new Set<(s: string) => void>(),
	};
	const term = {
		onData(cb: (s: string) => void) {
			listeners.text.add(cb);
			return { dispose: () => listeners.text.delete(cb) };
		},
		onBinary(cb: (s: string) => void) {
			listeners.binary.add(cb);
			return { dispose: () => listeners.binary.delete(cb) };
		},
	};
	const emit = (kind: keyof typeof listeners, data: string) => {
		for (const cb of listeners[kind]) cb(data);
	};
	return { term, emit, listeners };
}
function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("terminal input routing", () => {
	test("onBinary preserves high bits, shares replay gate, bypasses text heuristics, and disposes", () => {
		const h = harness();
		let replay = 0;
		let shiftPending = true;
		const text: string[] = [];
		const binary: string[] = [];
		const dispose = installTerminalInput(
			h.term,
			() => replay > 0,
			(s) => {
				if (shiftPending) {
					shiftPending = false;
					if (s === "\r") return;
				}
				text.push(s);
			},
			(s) => binary.push(s)
		);
		h.emit("binary", "\x1b[M\x80\xff");
		expect(shiftPending).toBe(true);
		h.emit("text", "\r");
		h.emit("text", "猫🐟");
		replay = 2;
		h.emit("binary", "drop");
		h.emit("text", "drop");
		replay--;
		h.emit("binary", "drop too");
		replay--;
		h.emit("text", "\x1b[<64;150;20M");
		expect(binary).toEqual(["\x1b[M\x80\xff"]);
		expect(text).toEqual(["猫🐟", "\x1b[<64;150;20M"]);
		dispose();
		dispose();
		expect(h.listeners.text.size + h.listeners.binary.size).toBe(0);
		h.emit("binary", "late");
		expect(binary).toHaveLength(1);
	});

	test("renderer → preload → main preserves byte strings and text arrival order across wake", async () => {
		const handlers = new Map<
			string,
			(e: unknown, id: unknown, data: unknown) => Promise<boolean>
		>();
		const gate = deferred();
		const received: Array<[string, string, string]> = [];
		let wakes = 0;
		registerTerminalInputIPC(
			{ handle: (channel, cb) => handlers.set(channel, cb) },
			{
				isConnected: true,
				write: (id, data) => {
					received.push(["text", id, data]);
					return true;
				},
				writeBinary: (id, data) => {
					received.push(["binary", id, data]);
					return true;
				},
			},
			async () => {
				if (++wakes === 1) await gate.promise;
			}
		);
		const promises: Promise<boolean>[] = [];
		const api = createTerminalInputAPI((channel, id, data) => {
			const handler = handlers.get(channel);
			if (!handler) throw Error(channel);
			const promise = handler(null, id, data);
			promises.push(promise);
			return promise;
		});
		const h = harness();
		const dispose = installTerminalInput(
			h.term,
			() => false,
			(data) => {
				void api.write("same-pty", data);
			},
			(data) => {
				void api.writeBinary("same-pty", data);
			}
		);
		h.emit("text", "猫🐟");
		h.emit("binary", "\x00\x80\xff");
		h.emit("text", "after");
		await Promise.resolve();
		expect(received).toEqual([]);
		gate.resolve();
		expect(await Promise.all(promises)).toEqual([true, true, true]);
		expect(received).toEqual([
			["text", "same-pty", "猫🐟"],
			["binary", "same-pty", "\x00\x80\xff"],
			["text", "same-pty", "after"],
		]);
		dispose();
	});

	test("an idle large paste is preserved while additional wake input stays bounded", async () => {
		const handlers = new Map<
			string,
			(e: unknown, id: unknown, data: unknown) => Promise<boolean>
		>();
		const gate = deferred();
		const received: string[] = [];
		registerTerminalInputIPC(
			{ handle: (channel, cb) => handlers.set(channel, cb) },
			{
				isConnected: true,
				write: (_id, data) => {
					received.push(data);
					return true;
				},
				writeBinary: () => true,
			},
			() => gate.promise
		);
		const handler = handlers.get("terminal:write");
		if (!handler) throw Error("missing text handler");
		const paste = `${"x".repeat(600_000)}猫🐟`;
		const first = handler(null, "t", paste);
		const queued = handler(null, "t", "queued");
		const other = handler(null, "other", paste);
		try {
			await Promise.resolve();
			expect(received).toEqual([]);
		} finally {
			gate.resolve();
		}
		expect(await first).toBe(true);
		expect(await queued).toBe(false);
		expect(await other).toBe(false);
		expect(received).toEqual([paste]);
		expect(await handler(null, "t", paste)).toBe(true);
		expect(received).toEqual([paste, paste]);
	});

	test("input received while disconnected is dropped before wake and cannot replay on reconnect", async () => {
		const handlers = new Map<
			string,
			(e: unknown, id: unknown, data: unknown) => Promise<boolean>
		>();
		let connected = false;
		let wakes = 0;
		const received: string[] = [];
		registerTerminalInputIPC(
			{ handle: (channel, cb) => handlers.set(channel, cb) },
			{
				get isConnected() {
					return connected;
				},
				write: (_id, data) => {
					received.push(data);
					return true;
				},
				writeBinary: (_id, data) => {
					received.push(data);
					return true;
				},
			},
			async () => {
				wakes++;
			}
		);
		const handler = handlers.get("terminal:write-binary");
		if (!handler) throw Error("missing binary handler");
		const result = handler(null, "t", "\xff");
		connected = true;
		expect(await result).toBe(false);
		expect(wakes).toBe(0);
		expect(received).toEqual([]);
	});

	test("main rejects malformed binary, bounds pending input, cancels stale wake input, and recovers after failure", async () => {
		const handlers = new Map<
			string,
			(e: unknown, id: unknown, data: unknown) => Promise<boolean>
		>();
		const gate = deferred();
		const received: string[] = [];
		let fail = false;
		const queue = registerTerminalInputIPC(
			{ handle: (channel, cb) => handlers.set(channel, cb) },
			{
				isConnected: true,
				write: (_id, data) => {
					received.push(data);
					return true;
				},
				writeBinary: (_id, data) => {
					received.push(data);
					return true;
				},
			},
			async () => {
				await gate.promise;
				if (fail) throw Error("wake failed");
			}
		);
		const binaryHandler = handlers.get("terminal:write-binary");
		if (!binaryHandler) throw Error("missing binary handler");
		const binary = (id: unknown, data: unknown) => binaryHandler(null, id, data);
		for (const [id, data] of [
			["", "x"],
			["t", "猫"],
			["t", null],
			["t", "x".repeat(16385)],
		]) {
			expect(await binary(id, data)).toBe(false);
		}
		const pending = Array.from({ length: 40 }, () => binary("t", "x".repeat(16384)));
		expect(await pending.at(-1)).toBe(false); // queue bound rejects before wake completes
		queue.invalidate("t");
		gate.resolve();
		expect((await Promise.all(pending)).every((value) => !value)).toBe(true);
		expect(received).toEqual([]);
		fail = true;
		await expect(binary("t", "x")).rejects.toThrow("wake failed");
		fail = false;
		expect(await binary("t", "\xff")).toBe(true);
		expect(received).toEqual(["\xff"]);
	});
});
