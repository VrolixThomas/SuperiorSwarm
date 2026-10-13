import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getWorkspaceCwdOrThrow } from "../src/main/agent-launch/workspace-cwd-lookup";
import { _setDbForTesting } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ensureTerminalSessionRow, saveTerminalSessions } from "../src/main/db/session-persistence";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { rendererTrust } from "../src/main/terminal/renderer-trust";
import { terminalFileOwners } from "../src/main/terminal/terminal-files";
import { makeRawTestDb } from "./test-db";

type Handler = (request: typeof event, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const sender = { id: 42, mainFrame: { routingId: 7 }, isDestroyed: () => false };
const event = { sender, senderFrame: { routingId: 7, url: "file:///fixture/index.html" } };
const caller = { senderId: 42, frameId: 7 };
mock.module("electron", () => ({
	app: { getPath: () => root, isPackaged: false },
	ipcMain: { handle: (name: string, fn: Handler) => handlers.set(name, fn) },
	BrowserWindow: {
		fromWebContents: () => ({ isDestroyed: () => false, webContents: { send: () => {} } }),
		getAllWindows: () => [],
	},
}));
const { setupTerminalIPC } = await import("../src/main/terminal/ipc");
const { terminalSessionsRouter } = await import("../src/main/trpc/routers/terminal-sessions");
const { terminalFilesRouter } = await import("../src/main/trpc/routers/terminal-files");
let root: string;
let raw: ReturnType<typeof makeRawTestDb>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let live = false;
let liveCwd: string | undefined;
let daemonError: Error | undefined;
let duringList: () => void | Promise<void> = () => {};
const created: Array<{ id: string; cwd: string | undefined }> = [];
const attached: Array<{ id: string; cwd: string | undefined }> = [];
const now = new Date();
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "coordinator-terminal-")));
	raw = makeRawTestDb();
	db = drizzle(raw, { schema });
	_setDbForTesting(db);
	live = false;
	liveCwd = undefined;
	daemonError = undefined;
	duringList = () => {};
	created.length = 0;
	attached.length = 0;
	rendererTrust.register(sender.id, event.senderFrame.url);
	setupTerminalIPC({
		hasLiveSession: () => live,
		isConnected: true,
		listSessionsStrict: async () => {
			await duringList();
			return db
				.select()
				.from(schema.terminalSessions)
				.all()
				.map((row) => ({ id: row.id, cwd: liveCwd ?? row.cwd, pid: 100 }));
		},
		create: async (id: string, cwd: string | undefined) => {
			if (daemonError) throw daemonError;
			created.push({ id, cwd });
		},
		attach: async (id: string, _data: unknown, _exit: unknown, cwd: string | undefined) => {
			attached.push({ id, cwd });
		},
		detach: () => {},
		addConnectionStatusListener: () => {},
	} as unknown as DaemonClient);
});
afterEach(() => {
	terminalFileOwners.invalidateSender(sender.id);
	rendererTrust.remove(sender.id);
	_setDbForTesting(null);
	raw.close();
	rmSync(root, { recursive: true, force: true });
});
function directory(name: string) {
	const path = join(root, name);
	mkdirSync(path);
	return path;
}
function coordinator(id = "xro-fixture", workDir = directory("coordinator"), kind = "workspace") {
	db.insert(schema.crossRepoOrchestrators)
		.values({
			id,
			name: "Fixture",
			workDir,
			agentKind: "claude",
			kind: kind as "workspace",
			sortOrder: 0,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id, workDir };
}
function workspace(id = "ordinary", repoPath = directory("project")) {
	db.insert(schema.projects)
		.values({ id: `project-${id}`, name: "Fixture", repoPath, createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.workspaces)
		.values({
			id,
			projectId: `project-${id}`,
			name: "Fixture",
			type: "branch",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id, repoPath };
}
function handler(name: string): Handler {
	const fn = handlers.get(name);
	if (!fn) throw new Error(`Missing IPC handler: ${name}`);
	return fn;
}
function create(id: string, workspaceId: string, cwd?: string) {
	return handler("terminal:create")(event, id, cwd, workspaceId);
}
function expectLookupError(id: string, code: string, message: string) {
	let error: unknown;
	try {
		getWorkspaceCwdOrThrow(id);
	} catch (caught) {
		error = caught;
	}
	expect(error).toMatchObject({ code, message });
	expect(String(error)).not.toContain(root);
}

describe("registered terminal directories", () => {
	test("ordinary project, folder and worktree precedence is preserved", () => {
		const ws = workspace();
		expect(getWorkspaceCwdOrThrow(ws.id)).toBe(ws.repoPath);
		const folderPath = directory("folder");
		db.update(schema.workspaces)
			.set({ type: "folder", folderPath })
			.where(eq(schema.workspaces.id, ws.id))
			.run();
		expect(getWorkspaceCwdOrThrow(ws.id)).toBe(folderPath);
		const path = directory("worktree");
		db.insert(schema.worktrees)
			.values({
				id: "wt",
				projectId: `project-${ws.id}`,
				path,
				branch: "fixture",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.update(schema.workspaces)
			.set({ worktreeId: "wt" })
			.where(eq(schema.workspaces.id, ws.id))
			.run();
		expect(getWorkspaceCwdOrThrow(ws.id)).toBe(path);
	});
	test("existing coordinator resolves its stored directory without ordinary workspace membership", () => {
		const xro = coordinator();
		expect(getWorkspaceCwdOrThrow(xro.id)).toBe(xro.workDir);
	});
	test("both record types canonicalize stored symlink aliases", () => {
		const canonical = directory("canonical");
		const alias = join(root, "alias");
		symlinkSync(canonical, alias);
		const ws = workspace("ordinary", alias);
		const xro = coordinator("xro-alias", alias);
		expect(getWorkspaceCwdOrThrow(ws.id)).toBe(canonical);
		expect(getWorkspaceCwdOrThrow(xro.id)).toBe(canonical);
	});
	test("missing records fail without ID-prefix or path fallback", () => {
		coordinator("xro-fixture-neighbor");
		expectLookupError("xro-fixture", "WORKSPACE_NOT_FOUND", "Workspace not found.");
	});
	for (const kind of ["external", "future", ""])
		test(`rejects unsupported kind ${JSON.stringify(kind)}`, () => {
			const xro = coordinator("xro-invalid", directory("unsupported"), kind);
			expectLookupError(
				xro.id,
				"WORKSPACE_KIND_UNSUPPORTED",
				"Coordinator kind does not support terminals."
			);
		});
	for (const path of ["", "relative/path", "\0invalid"])
		test(`rejects invalid stored path ${JSON.stringify(path)}`, () => {
			const xro = coordinator("xro-invalid", path);
			expectLookupError(xro.id, "WORKSPACE_PATH_INVALID", "Workspace folder path is invalid.");
		});
	test("deleted directory has a stable redacted failure", () => {
		const xro = coordinator();
		rmSync(xro.workDir, { recursive: true });
		expectLookupError(xro.id, "WORKSPACE_FOLDER_MISSING", "Workspace folder no longer exists.");
	});
	test("regular files cannot be terminal roots", () => {
		const path = join(root, "file");
		writeFileSync(path, "generated fixture");
		const xro = coordinator("xro-file", path);
		expectLookupError(xro.id, "WORKSPACE_NOT_DIRECTORY", "Workspace folder is not a directory.");
	});
	test("ordinary record wins a duplicate ID, including when its folder is missing", () => {
		const ws = workspace("same-id");
		coordinator(ws.id);
		expect(getWorkspaceCwdOrThrow(ws.id)).toBe(ws.repoPath);
		rmSync(ws.repoPath, { recursive: true });
		expectLookupError(ws.id, "WORKSPACE_FOLDER_MISSING", "Workspace folder no longer exists.");
	});
	test("schema defaults legacy inserts to workspace and rejects null kind/workDir", () => {
		db.insert(schema.crossRepoOrchestrators)
			.values({
				id: "legacy",
				name: "Fixture",
				workDir: root,
				agentKind: "claude",
				sortOrder: 0,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		expect(getWorkspaceCwdOrThrow("legacy")).toBe(root);
		for (const column of ["kind", "work_dir"])
			expect(() =>
				raw.exec(`UPDATE cross_repo_orchestrators SET ${column} = NULL WHERE id = 'legacy'`)
			).toThrow("NOT NULL");
	});
});
describe("real terminal:create ownership seam", () => {
	test("ordinary terminal create binds its registered root", async () => {
		const ws = workspace();
		expect(await create("term", ws.id, ws.repoPath)).toEqual({ wasAttached: false });
		expect(terminalFileOwners.target("term", caller)).toMatchObject({
			workspaceId: ws.id,
			root: ws.repoPath,
		});
	});
	test("new coordinator terminal registers ownership and creates", async () => {
		const xro = coordinator();
		expect(await create("term", xro.id, xro.workDir)).toEqual({ wasAttached: false });
		expect(created).toEqual([{ id: "term", cwd: xro.workDir }]);
		expect(terminalFileOwners.target("term", caller)).toMatchObject({
			workspaceId: xro.id,
			root: xro.workDir,
		});
	});
	test("restored coordinator terminal attaches with the same identity and detaches ownership", async () => {
		const xro = coordinator();
		ensureTerminalSessionRow({ id: "restored", workspaceId: xro.id, cwd: xro.workDir });
		live = true;
		expect(await create("restored", xro.id, xro.workDir)).toEqual({ wasAttached: true });
		expect(attached).toEqual([{ id: "restored", cwd: xro.workDir }]);
		expect(terminalFileOwners.target("restored", caller)).toMatchObject({
			workspaceId: xro.id,
			root: xro.workDir,
		});
		await handler("terminal:detach")(event, "restored");
		expect(() => terminalFileOwners.target("restored", caller)).toThrow("no longer attached");
	});
});

describe("coordinator session restoration", () => {
	test("restart keeps coordinator sessions and pane layouts and supplies stored cwd metadata", async () => {
		const xro = coordinator();
		ensureTerminalSessionRow({ id: "restored", workspaceId: xro.id, cwd: xro.workDir });
		db.insert(schema.paneLayouts)
			.values({ workspaceId: xro.id, layout: "{}", updatedAt: now })
			.run();
		const restored = await terminalSessionsRouter.createCaller({}).restore();
		expect(restored.sessions.map((row) => row.id)).toEqual(["restored"]);
		expect(restored.paneLayouts[xro.id]).toBe("{}");
		expect(restored.workspaceMeta[xro.id]).toMatchObject({ cwd: xro.workDir });
		live = true;
		const session = restored.sessions[0];
		if (!session) throw new Error("Missing restored coordinator session");
		expect(await create(session.id, xro.id, session.cwd)).toEqual({
			wasAttached: true,
		});
	});
	test("stale coordinator tabs survive for truthful lookup errors; removed ordinary workspaces stay filtered", async () => {
		ensureTerminalSessionRow({ id: "stale", workspaceId: "xro-deleted", cwd: root });
		ensureTerminalSessionRow({ id: "ordinary-deleted", workspaceId: "ws-deleted", cwd: root });
		const restored = await terminalSessionsRouter.createCaller({}).restore();
		expect(restored.sessions.map((row) => row.id)).toEqual(["stale"]);
		expect(() => getWorkspaceCwdOrThrow("xro-deleted")).toThrow("Workspace not found");
		expect(created).toEqual([]);
		expect(attached).toEqual([]);
	});
	test("unsupported coordinators remain diagnosable without granting a root", async () => {
		const xro = coordinator("external-fixture", root, "external");
		ensureTerminalSessionRow({ id: "unsupported", workspaceId: xro.id, cwd: root });
		const restored = await terminalSessionsRouter.createCaller({}).restore();
		expect(restored.sessions.map((row) => row.id)).toEqual(["unsupported"]);
		expect(restored.workspaceMeta[xro.id]).toBeUndefined();
		expect(() => getWorkspaceCwdOrThrow(xro.id)).toThrow("Coordinator kind");
	});
});

describe("terminal root and record isolation", () => {
	function expectFailure(result: unknown, code: string) {
		expect(result).toMatchObject({ error: { code } });
		expect(JSON.stringify(result)).not.toContain(root);
		expect(created).toEqual([]);
		expect(attached).toEqual([]);
	}
	test("new create ignores renderer cwd and persists the canonical registered root", async () => {
		const xro = coordinator();
		const arbitrary = directory("arbitrary");
		expect(await create("term", xro.id, arbitrary)).toEqual({ wasAttached: false });
		expect(created).toEqual([{ id: "term", cwd: xro.workDir }]);
		expect(db.select().from(schema.terminalSessions).get()?.cwd).toBe(xro.workDir);
	});
	test("omitted cwd resolves from the record instead of the home directory", async () => {
		const ws = workspace();
		await create("term", ws.id);
		expect(created).toEqual([{ id: "term", cwd: ws.repoPath }]);
		expect(db.select().from(schema.terminalSessions).get()?.cwd).toBe(ws.repoPath);
	});
	test("lookup failure is structured, creates no session row and registers no owner", async () => {
		expectFailure(await create("term", "xro-missing", root), "WORKSPACE_NOT_FOUND");
		expect(db.select().from(schema.terminalSessions).all()).toEqual([]);
		expect(() => terminalFileOwners.target("term", caller)).toThrow("no longer attached");
	});
	test("a stale restored coordinator cannot fall back to a different record at the same path", async () => {
		coordinator("xro-neighbor", root);
		ensureTerminalSessionRow({ id: "stale", workspaceId: "xro-missing", cwd: root });
		live = true;
		expectFailure(await create("stale", "xro-missing", root), "WORKSPACE_NOT_FOUND");
		expect(db.select().from(schema.terminalSessions).get()?.workspaceId).toBe("xro-missing");
	});
	test("same-looking IDs sharing one root cannot rebind a persisted terminal", async () => {
		coordinator("xro-one", root);
		coordinator("xro-one-more", root);
		ensureTerminalSessionRow({ id: "restored", workspaceId: "xro-one", cwd: root });
		live = true;
		expectFailure(await create("restored", "xro-one-more", root), "TERMINAL_WORKSPACE_MISMATCH");
	});
	test("a persisted terminal with a different root cannot attach", async () => {
		const xro = coordinator();
		ensureTerminalSessionRow({ id: "restored", workspaceId: xro.id, cwd: directory("other") });
		live = true;
		expectFailure(await create("restored", xro.id, xro.workDir), "WORKSPACE_ROOT_CHANGED");
	});
	test("a live daemon session with the same ID but another root cannot attach", async () => {
		const xro = coordinator();
		ensureTerminalSessionRow({ id: "restored", workspaceId: xro.id, cwd: xro.workDir });
		live = true;
		liveCwd = directory("coordinator-suffix");
		expectFailure(await create("restored", xro.id), "WORKSPACE_ROOT_CHANGED");
	});
	test("an unregistered live ID cannot be claimed by creating a new session row", async () => {
		const xro = coordinator();
		live = true;
		expectFailure(await create("unowned", xro.id), "TERMINAL_WORKSPACE_MISMATCH");
		expect(db.select().from(schema.terminalSessions).all()).toEqual([]);
	});
	test("directory replacement while checking a live session invalidates ownership", async () => {
		const xro = coordinator();
		ensureTerminalSessionRow({ id: "restored", workspaceId: xro.id, cwd: xro.workDir });
		live = true;
		duringList = () => {
			rmSync(xro.workDir, { recursive: true });
			symlinkSync(directory("replacement"), xro.workDir);
		};
		expectFailure(await create("restored", xro.id), "WORKSPACE_ROOT_CHANGED");
		expect(() => terminalFileOwners.target("restored", caller)).toThrow("no longer attached");
	});
	test("daemon transport failure is classified and rolls back new owner and session row", async () => {
		const xro = coordinator();
		daemonError = new Error("Daemon not connected");
		expectFailure(await create("term", xro.id), "DAEMON_UNAVAILABLE");
		expect(db.select().from(schema.terminalSessions).all()).toEqual([]);
		expect(() => terminalFileOwners.target("term", caller)).toThrow("no longer attached");
	});
	test("non-transport daemon errors do not claim reconnection will fix them", async () => {
		const xro = coordinator();
		daemonError = new Error(`Outbound create frame exceeds daemon frame limit ${root}`);
		expectFailure(await create("term", xro.id), "TERMINAL_CREATE_FAILED");
	});
	test("untrusted frame is rejected before persistence or owner registration", async () => {
		const xro = coordinator();
		const untrusted = { ...event, senderFrame: { ...event.senderFrame, routingId: 99 } };
		expectFailure(
			await handler("terminal:create")(untrusted, "term", root, xro.id),
			"TERMINAL_NOT_AUTHORIZED"
		);
		expect(db.select().from(schema.terminalSessions).all()).toEqual([]);
	});
	test("another trusted window cannot replace an active terminal owner", async () => {
		const xro = coordinator();
		await create("term", xro.id);
		const original = terminalFileOwners.target("term", caller);
		const other = { ...event, sender: { ...sender, id: 43 } };
		rendererTrust.register(43, event.senderFrame.url);
		try {
			const result = await handler("terminal:create")(other, "term", xro.workDir, xro.id);
			expect(result).toMatchObject({ error: { code: "TERMINAL_NOT_AUTHORIZED" } });
			expect(terminalFileOwners.target("term", caller)).toEqual(original);
		} finally {
			rendererTrust.remove(43);
		}
	});
	test("renderer save cannot rewrite the identity or root of an existing terminal", async () => {
		const xro = coordinator();
		await create("term", xro.id);
		saveTerminalSessions({
			sessions: [
				{
					id: "term",
					workspaceId: "other",
					cwd: directory("other"),
					title: "Renamed",
					sortOrder: 3,
				},
			],
			state: {},
		});
		expect(db.select().from(schema.terminalSessions).get()).toMatchObject({
			workspaceId: xro.id,
			cwd: xro.workDir,
			title: "Renamed",
			sortOrder: 3,
		});
	});
	test("failed owner re-registration cannot retain a lease to the former root", async () => {
		const xro = coordinator();
		await create("term", xro.id);
		const invalid = join(root, "not-a-directory");
		writeFileSync(invalid, "generated fixture");
		expect(() => terminalFileOwners.attach("term", caller, xro.id, invalid)).toThrow();
		expect(() => terminalFileOwners.target("term", caller)).toThrow("no longer attached");
	});
	test("file operations resolve the exact coordinator again and reject deleted records", async () => {
		const xro = coordinator();
		const source = join(root, "reference.txt");
		writeFileSync(source, "generated fixture");
		await create("term", xro.id);
		const api = terminalFilesRouter.createCaller({ fileCaller: caller });
		const batch = await api.prepare({ terminalId: "term", paths: [source] });
		expect(batch.target).toMatchObject({ workspaceId: xro.id, root: xro.workDir });
		db.delete(schema.crossRepoOrchestrators)
			.where(eq(schema.crossRepoOrchestrators.id, xro.id))
			.run();
		coordinator("xro-neighbor", xro.workDir);
		await expect(api.prepare({ terminalId: "term", paths: [source] })).rejects.toThrow(
			"Workspace not found"
		);
	});
	test("deleted roots during ownership validation have safe workspace errors", async () => {
		const xro = coordinator();
		await create("term", xro.id);
		rmSync(xro.workDir, { recursive: true });
		for (const operation of [
			() => terminalFileOwners.target("term", caller),
			() => terminalFileOwners.attach("term", caller, xro.id, xro.workDir),
		]) {
			let error: unknown;
			try {
				operation();
			} catch (caught) {
				error = caught;
			}
			expect(error).toMatchObject({ code: "WORKSPACE_ROOT_CHANGED" });
			expect(String(error)).not.toContain(root);
		}
	});
	test("a cancelled restored attach cannot clear a newer mount's owner", async () => {
		const xro = coordinator();
		ensureTerminalSessionRow({ id: "restored", workspaceId: xro.id, cwd: xro.workDir });
		live = true;
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		duringList = () => gate;
		const older = create("restored", xro.id);
		await handler("terminal:detach")(event, "restored");
		duringList = () => {};
		expect(await create("restored", xro.id)).toEqual({ wasAttached: true });
		const latest = terminalFileOwners.target("restored", caller);
		release();
		expect(await older).toMatchObject({ error: { code: "WORKSPACE_ROOT_CHANGED" } });
		expect(terminalFileOwners.target("restored", caller)).toEqual(latest);
	});
});
