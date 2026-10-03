import { afterAll, expect, mock, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { terminalFileOwners } from "../src/main/terminal/terminal-files";
const root = realpathSync(mkdtempSync(join(tmpdir(), "terminal-file-ipc-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const source = join(root, "a.pdf");
writeFileSync(source, "generated fixture");
const writes: string[] = [];
let state = "idle";
let nativeCalled = 0;
let exposed: { terminalFiles: { nativePaths: (files: File[]) => Array<string | null> } };
mock.module("electron", () => ({
	app: { getPath: () => root },
	contextBridge: {
		exposeInMainWorld: (_name: string, api: typeof exposed) => {
			exposed = api;
		},
	},
	ipcRenderer: { on: () => {}, invoke: async () => {} },
	webUtils: {
		getPathForFile: (file: File) => {
			nativeCalled++;
			return file.name === "native.pdf" ? source : "";
		},
	},
}));
mock.module("../src/main/agent-launch/workspace-cwd-lookup", () => ({
	getWorkspaceCwdOrThrow: () => root,
}));
mock.module("../src/main/services/agent-session-manager-handle", () => ({
	getAgentSessionManager: () => ({ getSession: () => ({ state }) }),
}));
mock.module("../src/main/terminal/daemon-instance", () => ({
	getDaemonClient: () => ({
		isConnected: true,
		fileTarget: async () => ({ generation: "pty-generation", supported: true, foreground: "zsh" }),
		insertFiles: async (_id: string, _generation: string, _text: string, payload: string) => {
			writes.push(payload);
			return "admitted";
		},
	}),
}));
const { terminalFilesRouter } = await import("../src/main/trpc/routers/terminal-files");
const caller = { senderId: 44, frameId: 7 };
const api = terminalFilesRouter.createCaller({ fileCaller: caller });

test("preload uses webUtils only, never File.path, names, MIME or renderer destinations", async () => {
	await import("../src/preload/index");
	const native = new File([], "native.pdf");
	const virtual = new File([], "virtual.pdf");
	Object.assign(virtual, { path: source });
	expect(exposed.terminalFiles.nativePaths([native, virtual])).toEqual([source, null]);
	expect(nativeCalled).toBe(2);
});
test("real tRPC procedures reject absent/cross-window context and wrong generation", async () => {
	terminalFileOwners.attach("term", caller, "ws", root);
	await expect(
		terminalFilesRouter.createCaller({}).prepare({ terminalId: "term", paths: [source] })
	).rejects.toThrow();
	const batch = await api.prepare({ terminalId: "term", paths: [source] });
	expect(writes).toEqual([]);
	await expect(
		terminalFilesRouter
			.createCaller({ fileCaller: { senderId: 45, frameId: 7 } })
			.resolve({ batchId: batch.id, ids: batch.entries.map((e) => e.id) })
	).rejects.toThrow();
	terminalFileOwners.invalidate("term", "detach");
	await expect(
		api.resolve({ batchId: batch.id, ids: batch.entries.map((e) => e.id) })
	).rejects.toThrow();
});
test("hibernated insertion never wakes; valid explicit paste is one-use and rejects added Enter", async () => {
	terminalFileOwners.attach("term", caller, "ws", root);
	const batch = await api.prepare({ terminalId: "term", paths: [source] });
	state = "hibernated";
	await expect(
		api.resolve({ batchId: batch.id, ids: batch.entries.map((e) => e.id) })
	).rejects.toThrow("idle");
	expect(writes).toEqual([]);
	state = "idle";
	const ready = await api.resolve({ batchId: batch.id, ids: batch.entries.map((e) => e.id) });
	await expect(
		api.insert({ batchId: batch.id, text: ready.text, payload: `${ready.text}\r` })
	).rejects.toThrow();
	expect(await api.insert({ batchId: batch.id, text: ready.text, payload: ready.text })).toBe(
		"admitted"
	);
	await expect(
		api.insert({ batchId: batch.id, text: ready.text, payload: ready.text })
	).rejects.toThrow();
	expect(writes).toEqual([ready.text]);
});
