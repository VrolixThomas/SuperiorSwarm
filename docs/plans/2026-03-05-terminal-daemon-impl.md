# Terminal Daemon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move terminal PTY processes into a persistent background daemon that survives app quit and crashes, reconnecting seamlessly on next launch.

**Architecture:** A separate Node.js process (`daemon/index.ts`) owns all `node-pty` instances and listens on a Unix socket (`~/.branchflux/daemon.sock`). The Electron main process becomes a thin client (`DaemonClient`) that proxies IPC calls from the renderer. PTY output is buffered in the daemon and flushed to the existing SQLite `terminal_sessions.scrollback` column; on reconnect the app replays the scrollback and attaches to the live PTY.

**Tech Stack:** `node-pty`, `better-sqlite3`, Node.js `net` (Unix sockets), NDJSON protocol, `ELECTRON_RUN_AS_NODE=1`, Bun test runner, existing Drizzle/SQLite schema.

---

## Reference: Key Existing Files

Before starting, read these files to understand what you are replacing or modifying:

- `apps/desktop/src/main/terminal/manager.ts` — current PTY owner (will be deleted)
- `apps/desktop/src/main/terminal/ipc.ts` — IPC handlers (will be updated)
- `apps/desktop/src/main/index.ts` — app entry (will be updated)
- `apps/desktop/src/main/db/session-persistence.ts` — SQLite writes (will be updated)
- `apps/desktop/src/renderer/App.tsx` — session restore (will be updated)
- `apps/desktop/src/shared/types.ts` — `SessionSaveData` type (will be updated)
- `apps/desktop/electron.vite.config.ts` — build config (will be updated)

---

## Task 1: Shared Protocol Types

**Files:**
- Create: `apps/desktop/src/shared/daemon-protocol.ts`

No test needed — pure TypeScript types with no runtime logic.

**Step 1: Create the file**

```typescript
// apps/desktop/src/shared/daemon-protocol.ts

export type ClientMessage =
	| { type: "create"; id: string; cwd?: string }
	| { type: "attach"; id: string }
	| { type: "detach"; id: string }
	| { type: "detach-all" }
	| { type: "write"; id: string; data: string }
	| { type: "resize"; id: string; cols: number; rows: number }
	| { type: "dispose"; id: string }
	| { type: "list" };

export type DaemonSession = { id: string; cwd: string; pid: number };

export type DaemonMessage =
	| { type: "ready" }
	| { type: "sessions"; sessions: DaemonSession[] }
	| { type: "data"; id: string; data: string } // base64-encoded PTY output
	| { type: "exit"; id: string; code: number }
	| { type: "error"; id: string; message: string };
```

**Step 2: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors in the new file

**Step 3: Commit**

```bash
git add apps/desktop/src/shared/daemon-protocol.ts
git commit -m "feat: add daemon protocol types"
```

---

## Task 2: Daemon PTY Manager

**Files:**
- Create: `apps/desktop/src/daemon/pty-manager.ts`
- Create: `apps/desktop/tests/daemon/pty-manager.test.ts`

The PTY manager owns `node-pty` instances and maintains a raw output ring buffer per terminal. Tests cover buffer management (not PTY spawning, which requires a real shell).

**Step 1: Write the failing test**

```typescript
// apps/desktop/tests/daemon/pty-manager.test.ts
import { describe, expect, test } from "bun:test";
import { trimBuffer } from "../../src/daemon/pty-manager";

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
		const input = "HEADER" + "x".repeat(100);
		const result = trimBuffer(input, 50);
		expect(result.startsWith("HEADER")).toBe(false);
		expect(result).toBe("x".repeat(50));
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/daemon/pty-manager.test.ts`
Expected: FAIL — `trimBuffer` not found

**Step 3: Implement `pty-manager.ts`**

```typescript
// apps/desktop/src/daemon/pty-manager.ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as pty from "node-pty";

const MAX_BUFFER_BYTES = 200_000;

interface TerminalEntry {
	pty: pty.IPty;
	cwd: string;
	buffer: string;
	dataListeners: Map<string, (data: string) => void>;
	exitListeners: Map<string, (code: number) => void>;
}

export function trimBuffer(buffer: string, maxBytes: number): string {
	if (buffer.length <= maxBytes) return buffer;
	return buffer.slice(buffer.length - maxBytes);
}

function resolveShell(): string {
	const candidates = [process.env["SHELL"], "/bin/zsh", "/bin/bash", "/bin/sh"];
	for (const sh of candidates) {
		if (sh && existsSync(sh)) return sh;
	}
	return "/bin/sh";
}

function resolveEnv(): Record<string, string> {
	const env = { ...process.env } as Record<string, string>;
	const defaults = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
	env["PATH"] = env["PATH"] ? `${env["PATH"]}:${defaults}` : defaults;
	return env;
}

export class PtyManager {
	private terminals = new Map<string, TerminalEntry>();

	create(
		id: string,
		cwd: string | undefined,
		onData: (data: string) => void,
		onExit: (code: number) => void,
		clientId: string
	): void {
		if (this.terminals.has(id)) {
			throw new Error(`Terminal "${id}" already exists`);
		}

		const resolvedCwd = cwd ?? homedir();
		const shell = resolveShell();
		const ptyProcess = pty.spawn(shell, ["-l"], {
			name: "xterm-256color",
			cols: 80,
			rows: 24,
			cwd: resolvedCwd,
			env: resolveEnv(),
		});

		const entry: TerminalEntry = {
			pty: ptyProcess,
			cwd: resolvedCwd,
			buffer: "",
			dataListeners: new Map([[clientId, onData]]),
			exitListeners: new Map([[clientId, onExit]]),
		};

		ptyProcess.onData((data) => {
			entry.buffer = trimBuffer(entry.buffer + data, MAX_BUFFER_BYTES);
			for (const cb of entry.dataListeners.values()) cb(data);
		});

		ptyProcess.onExit(({ exitCode }) => {
			for (const cb of entry.exitListeners.values()) cb(exitCode);
			this.terminals.delete(id);
		});

		this.terminals.set(id, entry);
	}

	// Returns the buffered content, or null if the session does not exist.
	attach(
		id: string,
		onData: (data: string) => void,
		onExit: (code: number) => void,
		clientId: string
	): string | null {
		const entry = this.terminals.get(id);
		if (!entry) return null;
		entry.dataListeners.set(clientId, onData);
		entry.exitListeners.set(clientId, onExit);
		return entry.buffer;
	}

	detachClient(clientId: string): void {
		for (const entry of this.terminals.values()) {
			entry.dataListeners.delete(clientId);
			entry.exitListeners.delete(clientId);
		}
	}

	write(id: string, data: string): void {
		this.terminals.get(id)?.pty.write(data);
	}

	resize(id: string, cols: number, rows: number): void {
		this.terminals.get(id)?.pty.resize(cols, rows);
	}

	dispose(id: string): void {
		const entry = this.terminals.get(id);
		if (entry) {
			try {
				entry.pty.kill("SIGKILL");
			} catch {}
			this.terminals.delete(id);
		}
	}

	has(id: string): boolean {
		return this.terminals.has(id);
	}

	list(): Array<{ id: string; cwd: string; pid: number }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			pid: e.pty.pid,
		}));
	}

	getBuffer(id: string): string {
		return this.terminals.get(id)?.buffer ?? "";
	}

	resetBuffer(id: string): void {
		const entry = this.terminals.get(id);
		if (entry) entry.buffer = "";
	}

	getAllBuffers(): Array<{ id: string; cwd: string; buffer: string }> {
		return [...this.terminals.entries()].map(([id, e]) => ({
			id,
			cwd: e.cwd,
			buffer: e.buffer,
		}));
	}

	disposeAll(): void {
		for (const [, entry] of this.terminals) {
			try {
				entry.pty.kill("SIGKILL");
			} catch {}
		}
		this.terminals.clear();
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/daemon/pty-manager.test.ts`
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/daemon/pty-manager.ts apps/desktop/tests/daemon/pty-manager.test.ts
git commit -m "feat: add daemon PTY manager with ring buffer"
```

---

## Task 3: Daemon Scrollback Store

**Files:**
- Create: `apps/desktop/src/daemon/scrollback-store.ts`
- Create: `apps/desktop/tests/daemon/scrollback-store.test.ts`

The scrollback store opens the SQLite DB and UPDATEs the `scrollback` column in `terminal_sessions`. It never INSERTs — the renderer owns row creation. The daemon owns the `scrollback` column only.

**Step 1: Write the failing test**

The test uses an in-memory SQLite DB with the minimal schema needed.

```typescript
// apps/desktop/tests/daemon/scrollback-store.test.ts
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ScrollbackStore } from "../../src/daemon/scrollback-store";

function makeTestDb(): Database.Database {
	const db = new Database(":memory:");
	db.pragma("journal_mode = WAL");
	// Minimal schema: just terminal_sessions
	db.exec(`
		CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL,
			default_branch TEXT NOT NULL DEFAULT 'main', color TEXT, github_owner TEXT, github_repo TEXT,
			status TEXT NOT NULL DEFAULT 'ready', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
		CREATE TABLE workspaces (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL,
			name TEXT NOT NULL, worktree_id TEXT, terminal_id TEXT, created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL);
		CREATE TABLE terminal_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
			title TEXT NOT NULL, cwd TEXT NOT NULL, scrollback TEXT, sort_order INTEGER NOT NULL,
			updated_at INTEGER NOT NULL);
	`);
	return db;
}

describe("ScrollbackStore", () => {
	let db: Database.Database;
	let store: ScrollbackStore;

	beforeEach(() => {
		db = makeTestDb();
		store = new ScrollbackStore(db);
	});

	afterEach(() => {
		store.close();
	});

	test("flush updates scrollback for existing rows", () => {
		db.prepare(
			`INSERT INTO terminal_sessions (id, workspace_id, title, cwd, scrollback, sort_order, updated_at)
			 VALUES (?, 'ws1', 'Terminal 1', '/tmp', NULL, 0, ?)`
		).run("term-1", Date.now());

		store.flush([{ id: "term-1", cwd: "/tmp", buffer: "hello world output" }]);

		const row = db
			.prepare("SELECT scrollback FROM terminal_sessions WHERE id = ?")
			.get("term-1") as { scrollback: string | null };
		expect(row.scrollback).toBe("hello world output");
	});

	test("flush is a no-op for missing rows (does not throw)", () => {
		expect(() =>
			store.flush([{ id: "nonexistent", cwd: "/tmp", buffer: "data" }])
		).not.toThrow();
	});

	test("flush skips entries with empty buffer", () => {
		db.prepare(
			`INSERT INTO terminal_sessions (id, workspace_id, title, cwd, scrollback, sort_order, updated_at)
			 VALUES (?, 'ws1', 'Terminal 1', '/tmp', 'previous', 0, ?)`
		).run("term-1", Date.now());

		store.flush([{ id: "term-1", cwd: "/tmp", buffer: "" }]);

		const row = db
			.prepare("SELECT scrollback FROM terminal_sessions WHERE id = ?")
			.get("term-1") as { scrollback: string | null };
		// Empty buffer should not overwrite existing scrollback
		expect(row.scrollback).toBe("previous");
	});

	test("flush handles multiple sessions in a single transaction", () => {
		for (const id of ["t1", "t2", "t3"]) {
			db.prepare(
				`INSERT INTO terminal_sessions (id, workspace_id, title, cwd, scrollback, sort_order, updated_at)
				 VALUES (?, 'ws1', 'T', '/tmp', NULL, 0, ?)`
			).run(id, Date.now());
		}

		store.flush([
			{ id: "t1", cwd: "/tmp", buffer: "output1" },
			{ id: "t2", cwd: "/tmp", buffer: "output2" },
			{ id: "t3", cwd: "/tmp", buffer: "output3" },
		]);

		for (const [id, expected] of [
			["t1", "output1"],
			["t2", "output2"],
			["t3", "output3"],
		]) {
			const row = db
				.prepare("SELECT scrollback FROM terminal_sessions WHERE id = ?")
				.get(id) as { scrollback: string };
			expect(row.scrollback).toBe(expected);
		}
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/daemon/scrollback-store.test.ts`
Expected: FAIL — `ScrollbackStore` not found

**Step 3: Implement `scrollback-store.ts`**

```typescript
// apps/desktop/src/daemon/scrollback-store.ts
import Database from "better-sqlite3";

export class ScrollbackStore {
	private db: Database.Database;
	private stmt: Database.Statement;

	// Accept an already-opened database (for testing) or a path string.
	constructor(dbOrPath: Database.Database | string) {
		if (typeof dbOrPath === "string") {
			this.db = new Database(dbOrPath);
			this.db.pragma("journal_mode = WAL");
			this.db.pragma("foreign_keys = ON");
		} else {
			this.db = dbOrPath;
		}
		this.stmt = this.db.prepare(
			`UPDATE terminal_sessions SET scrollback = ? WHERE id = ?`
		);
	}

	flush(sessions: Array<{ id: string; cwd: string; buffer: string }>): void {
		const tx = this.db.transaction(() => {
			for (const { id, buffer } of sessions) {
				if (buffer.length > 0) {
					this.stmt.run(buffer, id);
				}
			}
		});
		tx();
	}

	close(): void {
		// Only close if we own the DB (i.e., it was opened from a path).
		// When a Database instance is passed directly (tests), the caller manages lifecycle.
		try {
			if (this.db.open) this.db.close();
		} catch {}
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/daemon/scrollback-store.test.ts`
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/daemon/scrollback-store.ts apps/desktop/tests/daemon/scrollback-store.test.ts
git commit -m "feat: add daemon scrollback store (SQLite flush)"
```

---

## Task 4: Daemon Socket Server

**Files:**
- Create: `apps/desktop/src/daemon/socket-server.ts`
- Create: `apps/desktop/tests/daemon/socket-server.test.ts`

The socket server handles client connections, parses NDJSON, routes messages to `PtyManager`, and broadcasts output back. Tests use real Unix sockets with mock `PtyManager` and `ScrollbackStore`.

**Step 1: Write the failing test**

```typescript
// apps/desktop/tests/daemon/socket-server.test.ts
import { connect, type Socket } from "node:net";
import { rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SocketServer } from "../../src/daemon/socket-server";
import type { DaemonMessage } from "../../src/shared/daemon-protocol";

const TEST_SOCKET = join(tmpdir(), `branchflux-test-${process.pid}.sock`);

// Minimal mock PtyManager
class MockPtyManager {
	created: Array<{ id: string; cwd?: string }> = [];
	attached: string[] = [];
	disposed: string[] = [];
	written: Array<{ id: string; data: string }> = [];
	dataCallback: ((id: string, data: string) => void) | null = null;

	create(id: string, cwd: string | undefined, onData: (d: string) => void, _onExit: (c: number) => void, _clientId: string): void {
		this.created.push({ id, cwd });
		if (this.dataCallback) this.dataCallback(id, onData as unknown as string);
	}
	attach(id: string, _onData: (d: string) => void, _onExit: (c: number) => void, _clientId: string): string | null {
		this.attached.push(id);
		return "buffered-content";
	}
	dispose(id: string): void { this.disposed.push(id); }
	write(id: string, data: string): void { this.written.push({ id, data }); }
	resize(_id: string, _c: number, _r: number): void {}
	detachClient(_clientId: string): void {}
	list(): Array<{ id: string; cwd: string; pid: number }> { return [{ id: "t1", cwd: "/tmp", pid: 123 }]; }
	getBuffer(_id: string): string { return ""; }
	resetBuffer(_id: string): void {}
	getAllBuffers(): Array<{ id: string; cwd: string; buffer: string }> { return []; }
}

class MockScrollbackStore {
	flushed: Array<{ id: string; buffer: string }> = [];
	flush(sessions: Array<{ id: string; cwd: string; buffer: string }>): void {
		this.flushed.push(...sessions);
	}
	close(): void {}
}

function readMessages(socket: Socket): Promise<DaemonMessage[]> {
	return new Promise((resolve) => {
		const msgs: DaemonMessage[] = [];
		let buf = "";
		const timer = setTimeout(() => resolve(msgs), 200);
		socket.on("data", (chunk) => {
			buf += chunk.toString("utf-8");
			for (const line of buf.split("\n")) {
				if (!line.trim()) continue;
				try {
					msgs.push(JSON.parse(line) as DaemonMessage);
				} catch {}
			}
			buf = buf.includes("\n") ? buf.slice(buf.lastIndexOf("\n") + 1) : buf;
			clearTimeout(timer);
			setTimeout(() => resolve(msgs), 50);
		});
	});
}

function sendMessage(socket: Socket, msg: object): void {
	socket.write(JSON.stringify(msg) + "\n");
}

describe("SocketServer", () => {
	let server: SocketServer;
	let mockPty: MockPtyManager;
	let mockStore: MockScrollbackStore;

	beforeEach(() => {
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		mockPty = new MockPtyManager();
		mockStore = new MockScrollbackStore();
		server = new SocketServer(mockPty as never, mockStore as never, TEST_SOCKET);
		server.listen();
	});

	afterEach(() => {
		server.close();
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
	});

	test("sends ready on connect", async () => {
		const socket = connect(TEST_SOCKET);
		const msgs = await readMessages(socket);
		socket.destroy();
		expect(msgs.some((m) => m.type === "ready")).toBe(true);
	});

	test("list returns sessions", async () => {
		const socket = connect(TEST_SOCKET);
		await readMessages(socket); // consume ready
		sendMessage(socket, { type: "list" });
		const msgs = await readMessages(socket);
		socket.destroy();
		const sessions = msgs.find((m) => m.type === "sessions");
		expect(sessions?.type).toBe("sessions");
		if (sessions?.type === "sessions") {
			expect(sessions.sessions[0]?.id).toBe("t1");
		}
	});

	test("attach streams buffered content then registers client", async () => {
		const socket = connect(TEST_SOCKET);
		await readMessages(socket); // consume ready
		sendMessage(socket, { type: "attach", id: "term-1" });
		const msgs = await readMessages(socket);
		socket.destroy();
		expect(mockPty.attached).toContain("term-1");
		const dataMsg = msgs.find((m) => m.type === "data");
		expect(dataMsg?.type).toBe("data");
		if (dataMsg?.type === "data") {
			expect(Buffer.from(dataMsg.data, "base64").toString("utf-8")).toBe("buffered-content");
		}
	});

	test("dispose calls ptyManager.dispose", async () => {
		const socket = connect(TEST_SOCKET);
		await readMessages(socket);
		sendMessage(socket, { type: "dispose", id: "term-1" });
		await readMessages(socket);
		socket.destroy();
		expect(mockPty.disposed).toContain("term-1");
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/daemon/socket-server.test.ts`
Expected: FAIL — `SocketServer` not found

**Step 3: Implement `socket-server.ts`**

```typescript
// apps/desktop/src/daemon/socket-server.ts
import { createServer, type Server, type Socket } from "node:net";
import type { ClientMessage, DaemonMessage } from "../../shared/daemon-protocol";
import type { PtyManager } from "./pty-manager";
import type { ScrollbackStore } from "./scrollback-store";

let clientIdCounter = 0;

export class SocketServer {
	private server: Server;
	private clients = new Map<string, Socket>();

	constructor(
		private ptyManager: PtyManager,
		private scrollbackStore: ScrollbackStore,
		private socketPath: string
	) {
		this.server = createServer((socket) => this.onConnection(socket));
	}

	listen(): void {
		this.server.listen(this.socketPath);
	}

	close(): void {
		this.server.close();
		for (const socket of this.clients.values()) {
			socket.destroy();
		}
		this.clients.clear();
	}

	flush(): void {
		const buffers = this.ptyManager.getAllBuffers();
		this.scrollbackStore.flush(buffers);
		for (const { id } of buffers) {
			this.ptyManager.resetBuffer(id);
		}
	}

	private onConnection(socket: Socket): void {
		const clientId = `client-${++clientIdCounter}`;
		this.clients.set(clientId, socket);

		this.send(socket, { type: "ready" });

		let lineBuffer = "";
		socket.on("data", (chunk) => {
			lineBuffer += chunk.toString("utf-8");
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line) as ClientMessage;
					this.handleMessage(clientId, socket, msg);
				} catch {
					// ignore malformed
				}
			}
		});

		socket.on("close", () => {
			this.clients.delete(clientId);
			this.ptyManager.detachClient(clientId);
			this.flush();
		});

		socket.on("error", () => {
			// handled by close event
		});
	}

	private handleMessage(clientId: string, socket: Socket, msg: ClientMessage): void {
		switch (msg.type) {
			case "list": {
				this.send(socket, { type: "sessions", sessions: this.ptyManager.list() });
				break;
			}
			case "create": {
				try {
					this.ptyManager.create(
						msg.id,
						msg.cwd,
						(data) => {
							this.send(socket, {
								type: "data",
								id: msg.id,
								data: Buffer.from(data, "utf-8").toString("base64"),
							});
						},
						(code) => {
							this.send(socket, { type: "exit", id: msg.id, code });
							// Flush on natural exit before the entry is removed from ptyManager
							const buf = this.ptyManager.getBuffer(msg.id);
							if (buf.length > 0) {
								this.scrollbackStore.flush([{ id: msg.id, cwd: "", buffer: buf }]);
							}
						},
						clientId
					);
				} catch (err) {
					this.send(socket, { type: "error", id: msg.id, message: String(err) });
				}
				break;
			}
			case "attach": {
				const buffered = this.ptyManager.attach(
					msg.id,
					(data) => {
						this.send(socket, {
							type: "data",
							id: msg.id,
							data: Buffer.from(data, "utf-8").toString("base64"),
						});
					},
					(code) => {
						this.send(socket, { type: "exit", id: msg.id, code });
					},
					clientId
				);
				if (buffered === null) {
					this.send(socket, { type: "error", id: msg.id, message: "session not found" });
				} else if (buffered.length > 0) {
					this.send(socket, {
						type: "data",
						id: msg.id,
						data: Buffer.from(buffered, "utf-8").toString("base64"),
					});
				}
				break;
			}
			case "write": {
				this.ptyManager.write(msg.id, msg.data);
				break;
			}
			case "resize": {
				this.ptyManager.resize(msg.id, msg.cols, msg.rows);
				break;
			}
			case "dispose": {
				const buf = this.ptyManager.getBuffer(msg.id);
				const session = this.ptyManager.list().find((s) => s.id === msg.id);
				if (buf.length > 0 && session) {
					this.scrollbackStore.flush([{ id: msg.id, cwd: session.cwd, buffer: buf }]);
				}
				this.ptyManager.dispose(msg.id);
				break;
			}
			case "detach": {
				this.ptyManager.detachClient(clientId);
				break;
			}
			case "detach-all": {
				this.flush();
				this.ptyManager.detachClient(clientId);
				break;
			}
		}
	}

	private send(socket: Socket, msg: DaemonMessage): void {
		if (!socket.destroyed) {
			socket.write(JSON.stringify(msg) + "\n");
		}
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/daemon/socket-server.test.ts`
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/daemon/socket-server.ts apps/desktop/tests/daemon/socket-server.test.ts
git commit -m "feat: add daemon Unix socket server"
```

---

## Task 5: Daemon Entry Point + Build Config

**Files:**
- Create: `apps/desktop/src/daemon/index.ts`
- Modify: `apps/desktop/electron.vite.config.ts`

The daemon entry point starts the socket server, writes the PID file, sets up signal handlers for clean shutdown, and runs the periodic flush. The build config adds it as a separate compilation target.

**Step 1: Create the daemon entry point**

```typescript
// apps/desktop/src/daemon/index.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PtyManager } from "./pty-manager";
import { ScrollbackStore } from "./scrollback-store";
import { SocketServer } from "./socket-server";

const BRANCHFLUX_DIR = join(homedir(), ".branchflux");
const SOCKET_PATH = join(BRANCHFLUX_DIR, "daemon.sock");
const PID_PATH = join(BRANCHFLUX_DIR, "daemon.pid");
const DB_PATH = process.env["BRANCHFLUX_DB_PATH"] ?? "";
const FLUSH_INTERVAL_MS = 30_000;

if (!DB_PATH) {
	console.error("[daemon] BRANCHFLUX_DB_PATH not set, exiting");
	process.exit(1);
}

if (!existsSync(BRANCHFLUX_DIR)) {
	mkdirSync(BRANCHFLUX_DIR, { recursive: true });
}

// Remove stale socket from previous run
if (existsSync(SOCKET_PATH)) {
	try {
		rmSync(SOCKET_PATH);
	} catch {}
}

writeFileSync(PID_PATH, String(process.pid));

const ptyManager = new PtyManager();
const scrollbackStore = new ScrollbackStore(DB_PATH);
const socketServer = new SocketServer(ptyManager, scrollbackStore, SOCKET_PATH);

const flushInterval = setInterval(() => socketServer.flush(), FLUSH_INTERVAL_MS);

function shutdown(): void {
	clearInterval(flushInterval);
	socketServer.flush();
	socketServer.close();
	ptyManager.disposeAll();
	scrollbackStore.close();
	try {
		rmSync(SOCKET_PATH);
	} catch {}
	try {
		rmSync(PID_PATH);
	} catch {}
	process.exit(0);
}

for (const sig of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
	process.on(sig, shutdown);
}

process.on("uncaughtException", (err) => {
	console.error("[daemon] uncaughtException:", err);
	shutdown();
});

socketServer.listen();
console.log(`[daemon] started, pid=${process.pid}, socket=${SOCKET_PATH}`);
```

**Step 2: Add daemon build entry to `electron.vite.config.ts`**

In `electron.vite.config.ts`, add a `daemon` entry to the `main` build's `rollupOptions.input`. The daemon shares the same build pipeline as `main` (it uses the same Node.js native addons and does NOT use Electron's browser APIs). Add it alongside the existing `index` entry:

```typescript
// In the `main` section's build.rollupOptions.input:
input: {
	index: resolve(__dirname, "src/main/index.ts"),
	daemon: resolve(__dirname, "src/daemon/index.ts"),
},
```

The full `main` section after the change:

```typescript
main: {
	plugins: [externalizeDepsPlugin(), copyMigrationsPlugin()],
	define: {
		"process.env.JIRA_CLIENT_ID": JSON.stringify(process.env.JIRA_CLIENT_ID ?? ""),
		"process.env.JIRA_CLIENT_SECRET": JSON.stringify(process.env.JIRA_CLIENT_SECRET ?? ""),
		"process.env.BITBUCKET_CLIENT_ID": JSON.stringify(process.env.BITBUCKET_CLIENT_ID ?? ""),
		"process.env.BITBUCKET_CLIENT_SECRET": JSON.stringify(
			process.env.BITBUCKET_CLIENT_SECRET ?? ""
		),
		"process.env.LINEAR_CLIENT_ID": JSON.stringify(process.env.LINEAR_CLIENT_ID ?? ""),
		"process.env.LINEAR_CLIENT_SECRET": JSON.stringify(
			process.env.LINEAR_CLIENT_SECRET ?? ""
		),
	},
	build: {
		rollupOptions: {
			input: {
				index: resolve(__dirname, "src/main/index.ts"),
				daemon: resolve(__dirname, "src/daemon/index.ts"),
			},
		},
	},
},
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: no new errors

**Step 4: Commit**

```bash
git add apps/desktop/src/daemon/index.ts apps/desktop/electron.vite.config.ts
git commit -m "feat: add daemon entry point and build config"
```

---

## Task 6: Daemon Client (Main Process)

**Files:**
- Create: `apps/desktop/src/main/terminal/daemon-client.ts`
- Create: `apps/desktop/tests/daemon/daemon-client.test.ts`

The `DaemonClient` replaces `TerminalManager` in the Electron main process. It connects to the daemon socket, spawns the daemon if not running, maintains the live session set, and routes `terminal:data`/`terminal:exit` IPC events. A `quitting` flag prevents `dispose` from killing PTYs when the app is shutting down cleanly.

**Step 1: Write the failing tests**

```typescript
// apps/desktop/tests/daemon/daemon-client.test.ts
import { createServer, type Server, type Socket } from "node:net";
import { rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DaemonClient } from "../../src/main/terminal/daemon-client";
import type { DaemonMessage } from "../../src/shared/daemon-protocol";

const TEST_SOCKET = join(tmpdir(), `branchflux-client-test-${process.pid}.sock`);

function startMockDaemon(
	responses: (msg: object) => DaemonMessage | null
): Promise<{ server: Server; sockets: Socket[] }> {
	return new Promise((resolve) => {
		const sockets: Socket[] = [];
		const server = createServer((socket) => {
			sockets.push(socket);
			socket.write(JSON.stringify({ type: "ready" }) + "\n");
			let buf = "";
			socket.on("data", (chunk) => {
				buf += chunk.toString();
				const lines = buf.split("\n");
				buf = lines.pop() ?? "";
				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const msg = JSON.parse(line);
						if (msg.type === "list") {
							socket.write(
								JSON.stringify({ type: "sessions", sessions: [{ id: "term-1", cwd: "/tmp", pid: 99 }] }) + "\n"
							);
						}
						const resp = responses(msg);
						if (resp) socket.write(JSON.stringify(resp) + "\n");
					} catch {}
				}
			});
		});
		server.listen(TEST_SOCKET, () => resolve({ server, sockets }));
	});
}

describe("DaemonClient", () => {
	let daemon: { server: Server; sockets: Socket[] };
	let client: DaemonClient;

	beforeEach(async () => {
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
		daemon = await startMockDaemon(() => null);
		client = new DaemonClient(TEST_SOCKET);
		await client.connect();
	});

	afterEach(() => {
		client.disconnect();
		daemon.server.close();
		if (existsSync(TEST_SOCKET)) rmSync(TEST_SOCKET);
	});

	test("hasLiveSession returns true for daemon sessions", () => {
		expect(client.hasLiveSession("term-1")).toBe(true);
	});

	test("hasLiveSession returns false for unknown sessions", () => {
		expect(client.hasLiveSession("term-99")).toBe(false);
	});

	test("setQuitting prevents dispose from sending message", () => {
		const written: string[] = [];
		// Patch the socket to capture writes
		const socket = daemon.sockets[0];
		if (socket) {
			const orig = socket.write.bind(socket);
			socket.on("data", (chunk) => written.push(chunk.toString()));
		}
		client.setQuitting();
		client.dispose("term-1");
		// Give the event loop a tick
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				// No dispose message should be sent after setQuitting
				expect(written.some((w) => w.includes('"dispose"'))).toBe(false);
				resolve();
			}, 50);
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/desktop && bun test tests/daemon/daemon-client.test.ts`
Expected: FAIL — `DaemonClient` not found

**Step 3: Implement `daemon-client.ts`**

```typescript
// apps/desktop/src/main/terminal/daemon-client.ts
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ChildProcess, spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import type { ClientMessage, DaemonMessage } from "../../shared/daemon-protocol";

const BRANCHFLUX_DIR = join(homedir(), ".branchflux");
const DEFAULT_SOCKET_PATH = join(BRANCHFLUX_DIR, "daemon.sock");
const PID_PATH = join(BRANCHFLUX_DIR, "daemon.pid");
const CONNECT_TIMEOUT_MS = 5_000;
const CONNECT_POLL_MS = 100;

interface TerminalCallbacks {
	onData: (data: string) => void;
	onExit: (code: number) => void;
}

export class DaemonClient {
	private socket: Socket | null = null;
	private lineBuffer = "";
	private liveSessions = new Set<string>();
	private callbacks = new Map<string, TerminalCallbacks>();
	private pendingMessages = new Map<string, Array<(msg: DaemonMessage) => void>>();
	private isQuitting = false;
	private daemonProcess: ChildProcess | null = null;

	constructor(private socketPath: string = DEFAULT_SOCKET_PATH) {}

	async connect(dbPath?: string, daemonScriptPath?: string): Promise<void> {
		try {
			await this.tryConnect();
		} catch {
			if (!dbPath || !daemonScriptPath) {
				throw new Error("Daemon not running and no spawn params provided");
			}
			await this.spawnDaemon(dbPath, daemonScriptPath);
			await this.waitForSocket();
			await this.tryConnect();
		}

		// Wait for ready
		await this.waitForMessage("ready");

		// Get live session list
		this.send({ type: "list" });
		const sessionsMsg = await this.waitForMessage("sessions");
		if (sessionsMsg.type === "sessions") {
			for (const s of sessionsMsg.sessions) {
				this.liveSessions.add(s.id);
			}
		}
	}

	disconnect(): void {
		this.socket?.destroy();
		this.socket = null;
	}

	hasLiveSession(id: string): boolean {
		return this.liveSessions.has(id);
	}

	setQuitting(): void {
		this.isQuitting = true;
	}

	detachAll(): void {
		this.send({ type: "detach-all" });
	}

	async create(
		id: string,
		cwd: string | undefined,
		onData: (data: string) => void,
		onExit: (code: number) => void
	): Promise<void> {
		this.callbacks.set(id, { onData, onExit });
		this.liveSessions.add(id);
		this.send({ type: "create", id, cwd });
	}

	async attach(
		id: string,
		onData: (data: string) => void,
		onExit: (code: number) => void
	): Promise<void> {
		this.callbacks.set(id, { onData, onExit });
		this.send({ type: "attach", id });
	}

	write(id: string, data: string): void {
		this.send({ type: "write", id, data });
	}

	resize(id: string, cols: number, rows: number): void {
		this.send({ type: "resize", id, cols, rows });
	}

	dispose(id: string): void {
		if (this.isQuitting) return;
		this.callbacks.delete(id);
		this.liveSessions.delete(id);
		this.send({ type: "dispose", id });
	}

	private send(msg: ClientMessage): void {
		if (this.socket && !this.socket.destroyed) {
			this.socket.write(JSON.stringify(msg) + "\n");
		}
	}

	private setupMessageHandler(): void {
		if (!this.socket) return;
		this.socket.on("data", (chunk) => {
			this.lineBuffer += chunk.toString("utf-8");
			const lines = this.lineBuffer.split("\n");
			this.lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const msg = JSON.parse(line) as DaemonMessage;
					this.handleMessage(msg);
				} catch {}
			}
		});

		this.socket.on("close", () => {
			console.warn("[daemon-client] connection lost");
		});

		this.socket.on("error", (err) => {
			console.error("[daemon-client] socket error:", err.message);
		});
	}

	private handleMessage(msg: DaemonMessage): void {
		// Resolve pending one-shot listeners first
		const pending = this.pendingMessages.get(msg.type);
		if (pending && pending.length > 0) {
			const handler = pending.shift()!;
			if (pending.length === 0) this.pendingMessages.delete(msg.type);
			handler(msg);
			return;
		}

		switch (msg.type) {
			case "data": {
				const cb = this.callbacks.get(msg.id);
				if (cb) {
					cb.onData(Buffer.from(msg.data, "base64").toString("utf-8"));
				}
				break;
			}
			case "exit": {
				const cb = this.callbacks.get(msg.id);
				if (cb) {
					cb.onExit(msg.code);
					this.callbacks.delete(msg.id);
					this.liveSessions.delete(msg.id);
				}
				break;
			}
			case "error": {
				console.error(`[daemon-client] error for terminal ${msg.id}: ${msg.message}`);
				// If "attach" failed because session not found, create fresh
				if (msg.message === "session not found" && this.callbacks.has(msg.id)) {
					const cbs = this.callbacks.get(msg.id)!;
					this.send({ type: "create", id: msg.id });
					// callbacks are already set
				}
				break;
			}
		}
	}

	private waitForMessage<T extends DaemonMessage["type"]>(
		type: T
	): Promise<Extract<DaemonMessage, { type: T }>> {
		return new Promise((resolve) => {
			const listeners = this.pendingMessages.get(type) ?? [];
			listeners.push((msg) => resolve(msg as Extract<DaemonMessage, { type: T }>));
			this.pendingMessages.set(type, listeners);
		});
	}

	private tryConnect(): Promise<void> {
		return new Promise((resolve, reject) => {
			const socket = connect(this.socketPath);
			socket.once("connect", () => {
				this.socket = socket;
				this.setupMessageHandler();
				resolve();
			});
			socket.once("error", reject);
		});
	}

	private async spawnDaemon(dbPath: string, daemonScriptPath: string): Promise<void> {
		if (!existsSync(BRANCHFLUX_DIR)) {
			mkdirSync(BRANCHFLUX_DIR, { recursive: true });
		}

		// Check for stale PID file
		if (existsSync(PID_PATH)) {
			try {
				const pid = Number(readFileSync(PID_PATH, "utf-8").trim());
				if (pid) {
					try {
						process.kill(pid, 0); // Check if process exists
						// Process exists, wait for it to start accepting connections
						return;
					} catch {
						// Process doesn't exist, clean up stale files
						try { rmSync(PID_PATH); } catch {}
					}
				}
			} catch {}
		}

		const child = spawn(process.execPath, [daemonScriptPath], {
			detached: true,
			stdio: "ignore",
			env: {
				...process.env,
				ELECTRON_RUN_AS_NODE: "1",
				BRANCHFLUX_DB_PATH: dbPath,
			},
		});
		child.unref();
		this.daemonProcess = child;
	}

	private async waitForSocket(): Promise<void> {
		const deadline = Date.now() + CONNECT_TIMEOUT_MS;
		while (Date.now() < deadline) {
			if (existsSync(this.socketPath)) return;
			await new Promise((r) => setTimeout(r, CONNECT_POLL_MS));
		}
		throw new Error(`Daemon socket did not appear within ${CONNECT_TIMEOUT_MS}ms`);
	}
}

export const daemonClient = new DaemonClient();
```

**Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && bun test tests/daemon/daemon-client.test.ts`
Expected: all 3 tests PASS

**Step 5: Commit**

```bash
git add apps/desktop/src/main/terminal/daemon-client.ts apps/desktop/tests/daemon/daemon-client.test.ts
git commit -m "feat: add daemon client for main process"
```

---

## Task 7: Update Terminal IPC

**Files:**
- Modify: `apps/desktop/src/main/terminal/ipc.ts`

Replace all `terminalManager.*` calls with `daemonClient.*`. The `terminal:create` handler now attaches to an existing session if the daemon has it live, otherwise creates a fresh one.

**Step 1: Read the current file**

Read `apps/desktop/src/main/terminal/ipc.ts` in full before editing.

**Step 2: Replace the file contents**

```typescript
// apps/desktop/src/main/terminal/ipc.ts
import { BrowserWindow, ipcMain } from "electron";
import { daemonClient } from "./daemon-client";

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
}

export function setupTerminalIPC(): void {
	ipcMain.handle("terminal:create", async (event, id: unknown, cwd: unknown) => {
		assertNonEmptyString(id, "id");
		const cwdStr = typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;

		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) return;

		const onData = (data: string) => {
			if (!window.isDestroyed()) {
				window.webContents.send("terminal:data", id, data);
			}
		};
		const onExit = (exitCode: number) => {
			if (!window.isDestroyed()) {
				window.webContents.send("terminal:exit", id, exitCode);
			}
		};

		try {
			if (daemonClient.hasLiveSession(id)) {
				await daemonClient.attach(id, onData, onExit);
			} else {
				await daemonClient.create(id, cwdStr, onData, onExit);
			}
		} catch (error) {
			console.error(`Failed to create/attach terminal ${id}:`, error);
			throw error;
		}
	});

	ipcMain.handle("terminal:write", (_event, id: unknown, data: unknown) => {
		assertNonEmptyString(id, "id");
		if (typeof data !== "string") {
			throw new Error("data must be a string");
		}
		daemonClient.write(id, data);
	});

	ipcMain.handle("terminal:resize", (_event, id: unknown, cols: unknown, rows: unknown) => {
		assertNonEmptyString(id, "id");
		if (!Number.isInteger(cols) || (cols as number) < 1 || (cols as number) > 500) {
			throw new Error("cols must be an integer between 1 and 500");
		}
		if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > 500) {
			throw new Error("rows must be an integer between 1 and 500");
		}
		daemonClient.resize(id, cols as number, rows as number);
	});

	ipcMain.handle("terminal:dispose", (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		daemonClient.dispose(id);
	});
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors

**Step 4: Commit**

```bash
git add apps/desktop/src/main/terminal/ipc.ts
git commit -m "feat: route terminal IPC through daemon client"
```

---

## Task 8: Update Main Entry Point

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

Three changes:
1. Connect to daemon on startup (instead of nothing for terminals)
2. Send `detach-all` on quit instead of `terminalManager.disposeAll()`
3. Set the quitting flag before windows close so `dispose` calls are ignored

**Step 1: Read the current file**

Read `apps/desktop/src/main/index.ts` in full before editing.

**Step 2: Apply the changes**

Remove the import of `terminalManager` from `terminal/manager`. Add the `daemonClient` import. Change the startup and quit logic.

The key diff:

```typescript
// REMOVE this import:
import { terminalManager } from "./terminal/manager";

// ADD this import:
import { daemonClient } from "./terminal/daemon-client";
import { join } from "node:path";
```

In `app.whenReady()`:

```typescript
// After initializeDatabase() succeeds, connect to daemon:
const dbPath = /* get the same path used by initializeDatabase */
  join(app.getPath("userData"), "branchflux.db");
const daemonScriptPath = join(__dirname, "daemon.cjs");

try {
  await daemonClient.connect(dbPath, daemonScriptPath);
} catch (err) {
  console.error("[main] Failed to connect to terminal daemon:", err);
  // App continues — terminals will fail gracefully in the UI
}
```

Replace the `before-quit` handler:

```typescript
// REMOVE:
app.on("before-quit", () => {
  terminalManager.disposeAll();
  serverManager.disposeAll();
});

// REPLACE WITH:
app.on("before-quit", () => {
  daemonClient.setQuitting();
  daemonClient.detachAll();
  serverManager.disposeAll();
});
```

Replace the signal handlers at the bottom:

```typescript
// REMOVE terminalManager.disposeAll() from signal handlers:
for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
  process.on(signal, () => {
    daemonClient.setQuitting();
    daemonClient.detachAll();
    serverManager.disposeAll();
    app.exit(0);
  });
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors (and `manager.ts` is no longer imported)

**Step 4: Commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat: connect to daemon on startup, detach-all on quit"
```

---

## Task 9: Update Session Persistence (Preserve Daemon Scrollback)

**Files:**
- Modify: `apps/desktop/src/main/db/session-persistence.ts`
- Modify: `apps/desktop/src/shared/types.ts`
- Modify: `apps/desktop/src/main/trpc/routers/terminal-sessions.ts`

The renderer no longer writes the `scrollback` column — the daemon owns it. Change the session save from delete-all+insert to delete-removed+upsert-without-scrollback. Remove `scrollback` from `SessionSaveData`.

**Step 1: Read all three files**

Read each file in full before editing.

**Step 2: Update `src/shared/types.ts`**

Remove `scrollback` from the session shape in `SessionSaveData`:

```typescript
export interface SessionSaveData {
	sessions: Array<{
		id: string;
		workspaceId: string;
		title: string;
		cwd: string;
		// scrollback removed — daemon owns this column
		sortOrder: number;
	}>;
	state: Record<string, string>;
}
```

**Step 3: Update `src/main/db/session-persistence.ts`**

Replace the delete-all+insert pattern with delete-removed+upsert:

```typescript
// apps/desktop/src/main/db/session-persistence.ts
import { notInArray } from "drizzle-orm";
import type { SessionSaveData } from "../../shared/types";
import { getDb } from "./index";
import * as schema from "./schema";

export type { SessionSaveData };

export function saveTerminalSessions(data: SessionSaveData): void {
	const db = getDb();
	const now = new Date();
	const currentIds = data.sessions.map((s) => s.id);

	db.transaction((tx) => {
		// Delete sessions that are no longer open
		if (currentIds.length > 0) {
			tx.delete(schema.terminalSessions)
				.where(notInArray(schema.terminalSessions.id, currentIds))
				.run();
		} else {
			tx.delete(schema.terminalSessions).run();
		}

		// Upsert each open session — deliberately NOT touching the scrollback column
		// so the daemon's writes are preserved.
		for (const session of data.sessions) {
			tx
				.insert(schema.terminalSessions)
				.values({
					id: session.id,
					workspaceId: session.workspaceId,
					title: session.title,
					cwd: session.cwd,
					scrollback: null,
					sortOrder: session.sortOrder,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: schema.terminalSessions.id,
					set: {
						workspaceId: session.workspaceId,
						title: session.title,
						cwd: session.cwd,
						sortOrder: session.sortOrder,
						updatedAt: now,
						// scrollback intentionally omitted — daemon owns it
					},
				})
				.run();
		}

		// Session state: replace entirely (renderer owns this)
		tx.delete(schema.sessionState).run();
		for (const [key, value] of Object.entries(data.state)) {
			tx.insert(schema.sessionState).values({ key, value }).run();
		}
	});
}
```

**Step 4: Update `src/main/trpc/routers/terminal-sessions.ts`**

Remove `scrollback` from the `sessionInput` schema:

```typescript
const sessionInput = z.object({
	id: z.string(),
	workspaceId: z.string(),
	title: z.string(),
	cwd: z.string(),
	// scrollback removed — daemon writes this column
	sortOrder: z.number().int(),
});
```

**Step 5: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: errors will appear in `App.tsx` where `scrollback` is still referenced — that is fixed in Task 10.

**Step 6: Commit** (after Task 10 fixes the compilation)

Wait — commit after Task 10 resolves the type errors.

---

## Task 10: Update App.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`

Two changes:
1. Stop collecting scrollback from `scrollbackRegistry` (daemon owns it now)
2. The `initialContent` passed to `Terminal` is still read from `restoreQuery.data` (daemon-written content) — no change needed there

**Step 1: Read the current file**

Read `apps/desktop/src/renderer/App.tsx` in full before editing.

**Step 2: Update `collectSnapshot`**

Remove the `scrollbackRegistry` import and the scrollback collection:

```typescript
// REMOVE this import:
import { scrollbackRegistry } from "./components/Terminal";

// In collectSnapshot(), change sessions mapping:
const sessions = terminalTabs.map((tab, i) => ({
	id: tab.id,
	workspaceId: tab.workspaceId,
	title: tab.title,
	cwd: tab.kind === "terminal" ? tab.cwd : "",
	// scrollback omitted — daemon owns that column
	sortOrder: i,
}));
```

**Step 3: Remove `savedScrollback` state and pass scrollback from query directly**

The `savedScrollback` state in `App.tsx` populated from `restoreQuery.data.sessions[].scrollback` still works because the daemon writes to that column. No change needed here — keep reading it from the DB.

**Step 4: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors (the `scrollback` type errors from Task 9 are now resolved)

**Step 5: Commit Tasks 9 and 10 together**

```bash
git add apps/desktop/src/shared/types.ts \
        apps/desktop/src/main/db/session-persistence.ts \
        apps/desktop/src/main/trpc/routers/terminal-sessions.ts \
        apps/desktop/src/renderer/App.tsx
git commit -m "feat: daemon owns scrollback column, renderer stops writing it"
```

---

## Task 11: Delete `manager.ts`

**Files:**
- Delete: `apps/desktop/src/main/terminal/manager.ts`

`manager.ts` is now fully replaced by `daemon-client.ts`. Verify no remaining imports before deleting.

**Step 1: Check for remaining imports**

Run: `cd apps/desktop && grep -r "terminal/manager" src/`
Expected: no results (you removed the import from `index.ts` in Task 8)

**Step 2: Delete the file**

```bash
rm apps/desktop/src/main/terminal/manager.ts
```

**Step 3: Verify TypeScript compiles**

Run: `cd apps/desktop && bun run type-check`
Expected: no errors

**Step 4: Commit**

```bash
git add -u apps/desktop/src/main/terminal/manager.ts
git commit -m "feat: remove in-process terminal manager (replaced by daemon)"
```

---

## Task 12: Run Full Test Suite and Verify

**Step 1: Run all tests**

Run: `cd apps/desktop && bun test`
Expected: all existing tests pass, plus the new daemon tests pass. If any pre-existing tests reference `terminal/manager` or `terminalManager`, update them to use `daemonClient` or remove them.

**Step 2: Run type-check one final time**

Run: `cd apps/desktop && bun run type-check`
Expected: zero errors

**Step 3: Run linter**

Run: `cd apps/desktop && bun run check`
Expected: no lint errors (fix any Biome warnings before committing)

**Step 4: Manual smoke test (requires running the app)**

```bash
bun run dev
```

Verify:
1. App launches without errors in terminal
2. Open a terminal tab — shell appears
3. Run a long-running command (e.g. `sleep 60`)
4. Quit the app (Cmd+Q)
5. Relaunch — the terminal tab is restored with scrollback, and `sleep` is still counting down (PTY survived)
6. Close a terminal tab via the UI — it does NOT survive relaunch
7. Crash the app (kill -9 from another terminal) — on relaunch, the terminal is still alive

**Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: post-integration cleanup from daemon smoke test"
```

---

## Summary of All New/Changed Files

| Action | File |
|---|---|
| Create | `apps/desktop/src/shared/daemon-protocol.ts` |
| Create | `apps/desktop/src/daemon/index.ts` |
| Create | `apps/desktop/src/daemon/pty-manager.ts` |
| Create | `apps/desktop/src/daemon/scrollback-store.ts` |
| Create | `apps/desktop/src/daemon/socket-server.ts` |
| Create | `apps/desktop/src/main/terminal/daemon-client.ts` |
| Create | `apps/desktop/tests/daemon/pty-manager.test.ts` |
| Create | `apps/desktop/tests/daemon/scrollback-store.test.ts` |
| Create | `apps/desktop/tests/daemon/socket-server.test.ts` |
| Create | `apps/desktop/tests/daemon/daemon-client.test.ts` |
| Modify | `apps/desktop/src/main/terminal/ipc.ts` |
| Modify | `apps/desktop/src/main/index.ts` |
| Modify | `apps/desktop/src/main/db/session-persistence.ts` |
| Modify | `apps/desktop/src/main/trpc/routers/terminal-sessions.ts` |
| Modify | `apps/desktop/src/shared/types.ts` |
| Modify | `apps/desktop/src/renderer/App.tsx` |
| Modify | `apps/desktop/electron.vite.config.ts` |
| **Delete** | `apps/desktop/src/main/terminal/manager.ts` |

**Unchanged** (zero modifications needed):
- `src/renderer/components/Terminal.tsx`
- `src/preload/index.ts`
- `src/main/db/schema.ts`
- `src/renderer/stores/tab-store.ts`
