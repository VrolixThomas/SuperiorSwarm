import "../../preload-electron-mock";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { FileInputSessions } from "../../../src/daemon/file-input-sessions";
import type { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { closeDb, getDb } from "../../../src/main/db";
import { projects, terminalSessions } from "../../../src/main/db/schema";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { seedProject, seedWorkspace, setupTestDb } from "../../helpers/db";

const root = process.env["SS_OWNED_CHAT_FIXTURE_ROOT"];
if (!root) throw Error("Missing isolated fixture directory");
const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const output: unknown[][] = [];
const window = {
	isDestroyed: () => false,
	webContents: { send: (...args: unknown[]) => output.push(args) },
};
const sender = { id: 901, mainFrame: { routingId: 7 }, isDestroyed: () => false };
const event = {
	sender,
	senderFrame: { routingId: 7, url: "file:///owned-chat-fixture/index.html" },
};
mock.module("electron", () => ({
	app: { getPath: () => root, isPackaged: false },
	ipcMain: {
		handle: (name: string, fn: (...args: unknown[]) => Promise<unknown>) => handlers.set(name, fn),
		on: () => {},
	},
	BrowserWindow: { fromWebContents: () => window, getAllWindows: () => [window] },
}));
const { setupTerminalIPC } = await import("../../../src/main/terminal/ipc");
const records = new Map<
	string,
	{ cwd: string; env?: Record<string, string>; listeners: Map<string, (data: string) => void> }
>();
let creates = 0;
const fileInputs = new FileInputSessions();
const ptys = {
	fileInputs,
	create: (
		id: string,
		cwd: string,
		onData: (data: string) => void,
		_onExit: unknown,
		client: string,
		env?: Record<string, string>
	) => {
		assert(!records.has(id), "Duplicate physical PTY create");
		creates++;
		records.set(id, { cwd, env, listeners: new Map([[client, onData]]) });
		fileInputs.create(
			id,
			client,
			"/bin/zsh",
			() => "zsh",
			() => {}
		);
	},
	attach: (id: string, onData: (data: string) => void, _onExit: unknown, client: string) => {
		const record = records.get(id);
		if (!record) return null;
		record.listeners.set(client, onData);
		fileInputs.attach(id, client);
		return { buffer: "", process: "zsh" };
	},
	list: () => [...records].map(([id, row]) => ({ id, cwd: row.cwd, pid: 42 })),
	getDirtyBuffers: () => [],
	markBuffersFlushed: () => {},
	detachClient: (client: string) => {
		for (const record of records.values()) record.listeners.delete(client);
		fileInputs.clear();
	},
	write: (id: string, data: string) => {
		const record = records.get(id);
		assert(record);
		for (const listener of record.listeners.values()) listener(data);
	},
};
const socket = join(root, "daemon.sock");
const server = new SocketServer(
	ptys as unknown as PtyManager,
	{ flush: () => [] } as unknown as ScrollbackStore,
	socket
);
const daemon = new DaemonClient(socket, join(root, "pid"), join(root, "daemon.log"));
try {
	setupTestDb();
	const projectId = await seedProject();
	getDb()
		.update(projects)
		.set({ repoPath: root, kind: "folder" })
		.where(eq(projects.id, projectId))
		.run();
	const workspaceId = await seedWorkspace(projectId, { name: "Own folder chat", type: "branch" });
	getDb()
		.insert(terminalSessions)
		.values({
			id: "exact-chat",
			workspaceId,
			cwd: root,
			title: "Claude chat",
			sortOrder: 0,
			updatedAt: new Date(),
		})
		.run();
	server.listen();
	await daemon.connect();
	setupTerminalIPC(daemon);
	rendererTrust.register(sender.id, event.senderFrame.url);
	const create = handlers.get("terminal:create");
	assert(create);
	const results = await Promise.all([
		create(event, "exact-chat", "/renderer-cwd-is-not-authority", workspaceId),
		create(event, "exact-chat", root, workspaceId),
	]);
	assert(
		results.every(
			(value) => !!value && typeof value === "object" && !("ok" in value && value.ok === false)
		)
	);
	await daemon.listSessionsStrict();
	assert.equal(creates, 1);
	assert.equal(records.size, 1);
	const record = records.get("exact-chat");
	assert(record);
	assert.equal(record.cwd, root);
	assert.equal(record.env?.["AGENT_NOTIFY_TERMINAL_ID"], "exact-chat");
	assert.equal(record.env?.["AGENT_NOTIFY_WORKSPACE_ID"], workspaceId);
	assert.equal(record.listeners.size, 1);
	daemon.write("exact-chat", "one retained callback");
	await daemon.listSessionsStrict();
	assert.equal(
		output.filter((args) => args[0] === "terminal:data" && args[2] === "one retained callback")
			.length,
		1
	);
	console.log(
		"PASS: concurrent mount and explicit create produce one terminal, one callback, preserved callback owner"
	);
} finally {
	rendererTrust.remove(sender.id);
	daemon.disconnect();
	server.close();
	closeDb();
}
