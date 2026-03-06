import { afterEach, describe, expect, test } from "bun:test";
import { PtyManager, trimBuffer } from "../../src/daemon/pty-manager";

describe("trimBuffer", () => {
	test("returns buffer unchanged when under limit", () => {
		expect(trimBuffer("hello", 100)).toBe("hello");
	});

	test("trims to last maxBytes when over limit", () => {
		const big = "a".repeat(300);
		const result = trimBuffer(big, 200);
		expect(result.length).toBe(200);
		expect(result).toBe("a".repeat(200));
	});

	test("handles empty string", () => {
		expect(trimBuffer("", 100)).toBe("");
	});

	test("preserves tail content, not head", () => {
		const input = `HEADER${"x".repeat(100)}`;
		const result = trimBuffer(input, 50);
		expect(result.startsWith("HEADER")).toBe(false);
		expect(result).toBe("x".repeat(50));
	});
});

// ---------------------------------------------------------------------------
// PtyManager lifecycle tests (spawn real PTYs)
// ---------------------------------------------------------------------------
// Note: node-pty's onData events do not fire reliably under Bun's event loop
// (Bun does not use libuv). Tests cover lifecycle management (create, dispose,
// list, has, attach, detach, write, resize) by verifying the PTY process spawns
// with a valid PID and that the Map-based bookkeeping works correctly. Data-flow
// tests that depend on onData callbacks are not feasible under Bun.

describe("PtyManager", () => {
	let manager: PtyManager;

	// Fresh manager per test; disposeAll guarantees no leaked PTYs.
	const setup = () => {
		manager = new PtyManager();
	};

	afterEach(() => {
		manager.disposeAll();
	});

	// -- create --

	test("create registers a terminal with has() and list()", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"client-1"
		);

		expect(manager.has("t1")).toBe(true);
		const entries = manager.list();
		expect(entries).toHaveLength(1);
		expect(entries[0]?.id).toBe("t1");
		expect(entries[0]?.pid).toBeGreaterThan(0);
		expect(entries[0]?.cwd).toBeTypeOf("string");
	});

	test("create throws on duplicate ID", () => {
		setup();
		manager.create(
			"dup",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(() => {
			manager.create(
				"dup",
				undefined,
				() => {},
				() => {},
				"c1"
			);
		}).toThrow('Terminal "dup" already exists');
	});

	test("create with explicit cwd records that cwd", () => {
		setup();
		manager.create(
			"t1",
			"/tmp",
			() => {},
			() => {},
			"c1"
		);
		const entries = manager.list();
		expect(entries[0]?.cwd).toBe("/tmp");
	});

	// -- attach --

	test("attach returns buffer string for existing session", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);

		// Buffer starts empty (no data has arrived from the PTY yet).
		const buffered = manager.attach(
			"t1",
			() => {},
			() => {},
			"c2"
		);
		expect(buffered).toBeTypeOf("string");
		expect(buffered).toBe("");
	});

	test("attach returns null for nonexistent session", () => {
		setup();
		const result = manager.attach(
			"nope",
			() => {},
			() => {},
			"c1"
		);
		expect(result).toBeNull();
	});

	test("attach does not duplicate the terminal entry", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.attach(
			"t1",
			() => {},
			() => {},
			"c2"
		);

		// Still only one terminal in the list.
		expect(manager.list()).toHaveLength(1);
	});

	// -- detachClient --

	test("detachClient does not remove the terminal itself", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.detachClient("c1");

		// Terminal still exists even after the creating client detaches.
		expect(manager.has("t1")).toBe(true);
	});

	test("detachClient on unknown client does not throw", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(() => manager.detachClient("unknown-client")).not.toThrow();
	});

	// -- dispose --

	test("dispose removes terminal from map", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(manager.has("t1")).toBe(true);
		manager.dispose("t1");
		expect(manager.has("t1")).toBe(false);
		expect(manager.list()).toHaveLength(0);
	});

	test("dispose is idempotent for nonexistent ID", () => {
		setup();
		expect(() => manager.dispose("ghost")).not.toThrow();
	});

	test("dispose followed by create with same ID works", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.dispose("t1");
		// Re-creating with the same ID should succeed.
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(manager.has("t1")).toBe(true);
	});

	// -- write / resize to nonexistent terminal --

	test("write to nonexistent terminal warns but does not throw", () => {
		setup();
		expect(() => manager.write("nope", "hello")).not.toThrow();
	});

	test("write to existing terminal does not throw", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(() => manager.write("t1", "echo hello\n")).not.toThrow();
	});

	test("resize to nonexistent terminal warns but does not throw", () => {
		setup();
		expect(() => manager.resize("nope", 120, 40)).not.toThrow();
	});

	test("resize to existing terminal does not throw", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(() => manager.resize("t1", 120, 40)).not.toThrow();
	});

	// -- list --

	test("list returns all active terminals", () => {
		setup();
		manager.create(
			"a",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.create(
			"b",
			undefined,
			() => {},
			() => {},
			"c1"
		);

		const entries = manager.list();
		const ids = entries.map((e) => e.id).sort();
		expect(ids).toEqual(["a", "b"]);
		for (const entry of entries) {
			expect(entry.pid).toBeGreaterThan(0);
			expect(entry.cwd).toBeTypeOf("string");
		}
	});

	test("list returns empty array when no terminals exist", () => {
		setup();
		expect(manager.list()).toEqual([]);
	});

	// -- disposeAll --

	test("disposeAll clears all terminals", () => {
		setup();
		manager.create(
			"x",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.create(
			"y",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		expect(manager.list()).toHaveLength(2);

		manager.disposeAll();
		expect(manager.list()).toHaveLength(0);
		expect(manager.has("x")).toBe(false);
		expect(manager.has("y")).toBe(false);
	});

	test("disposeAll is safe when no terminals exist", () => {
		setup();
		expect(() => manager.disposeAll()).not.toThrow();
	});

	// -- getBuffer --

	test("getBuffer returns empty string for nonexistent terminal", () => {
		setup();
		expect(manager.getBuffer("missing")).toBe("");
	});

	test("getBuffer returns empty string for newly created terminal", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		// Before any data arrives, buffer is empty.
		expect(manager.getBuffer("t1")).toBe("");
	});

	// -- resetBuffer --

	test("resetBuffer on fresh terminal keeps buffer empty", () => {
		setup();
		manager.create(
			"t1",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.resetBuffer("t1");
		expect(manager.getBuffer("t1")).toBe("");
	});

	test("resetBuffer on nonexistent terminal does not throw", () => {
		setup();
		expect(() => manager.resetBuffer("nope")).not.toThrow();
	});

	// -- getAllBuffers --

	test("getAllBuffers returns entries for all terminals", () => {
		setup();
		manager.create(
			"a",
			"/tmp",
			() => {},
			() => {},
			"c1"
		);
		manager.create(
			"b",
			undefined,
			() => {},
			() => {},
			"c1"
		);

		const buffers = manager.getAllBuffers();
		expect(buffers).toHaveLength(2);
		const ids = buffers.map((b) => b.id).sort();
		expect(ids).toEqual(["a", "b"]);
		for (const entry of buffers) {
			expect(entry.buffer).toBe("");
			expect(entry.cwd).toBeTypeOf("string");
		}
	});

	test("getAllBuffers returns empty array when no terminals exist", () => {
		setup();
		expect(manager.getAllBuffers()).toEqual([]);
	});

	// -- PIDs are unique per terminal --

	test("each terminal gets a unique PID", () => {
		setup();
		manager.create(
			"a",
			undefined,
			() => {},
			() => {},
			"c1"
		);
		manager.create(
			"b",
			undefined,
			() => {},
			() => {},
			"c1"
		);

		const entries = manager.list();
		const pids = entries.map((e) => e.pid);
		expect(new Set(pids).size).toBe(2);
	});
});
