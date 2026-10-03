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
let probes = 0;
let managed = false;
let submitCapable = true;
let supported = true;
let needsFileInputUpdate = false;
let requestedManaged = false;
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
	getAgentSessionManager: () => ({ getSession: () => ({ state, managed }) }),
}));
mock.module("../src/main/terminal/daemon-instance", () => ({
	getDaemonClient: () => ({
		isConnected: true,
		get needsFileInputUpdate() {
			return needsFileInputUpdate;
		},
		get supportsFileSubmit() {
			return submitCapable;
		},
		fileTarget: async (_id: string, allowManaged = false) => {
			requestedManaged = allowManaged;
			probes++;
			return { generation: "pty-generation", supported, foreground: "zsh" };
		},
		insertFiles: async (
			_id: string,
			_generation: string,
			_text: string,
			payload: string,
			submit = false
		) => {
			writes.push(submit ? `${payload}\r` : payload);
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

test("append keeps the original daemon lease and an explicit send includes all selected references", async () => {
	terminalFileOwners.attach("append-term", caller, "ws", root);
	const first = await api.prepare({ terminalId: "append-term", paths: [source] });
	const calls = probes;
	const second = join(root, "second.mov");
	writeFileSync(second, "generated fixture");
	const appended = await api.append({
		batchId: first.id,
		paths: [second],
		retainedIds: first.entries.map((e) => e.id),
	});
	expect(probes).toBe(calls);
	expect(appended.id).toBe(first.id);
	expect(appended.entries.map((e) => e.path)).toEqual([source, second]);
	const prepared = await api.resolve({
		batchId: appended.id,
		ids: appended.entries.map((e) => e.id),
		submit: true,
	});
	expect(
		await api.insert({
			batchId: appended.id,
			text: prepared.text,
			payload: prepared.text,
			submit: true,
		})
	).toBe("admitted");
	expect(writes.at(-1)).toBe(` '${source}' '${second}' \r`);
});

test("managed runtime permission comes from main session ownership, never renderer assertions", async () => {
	terminalFileOwners.attach("runtime-term", caller, "ws", root);
	await api.prepare({
		terminalId: "runtime-term",
		paths: [source],
		managedAgent: true,
	} as Parameters<typeof api.prepare>[0]);
	expect(requestedManaged).toBe(false);
	managed = true;
	try {
		await api.prepare({ terminalId: "runtime-term", paths: [source] });
		expect(requestedManaged).toBe(true);
	} finally {
		managed = false;
	}
});

test("explicit send accepts the running state caused by ordinary draft typing, but still rejects sleep and approval states", async () => {
	terminalFileOwners.attach("draft-term", caller, "ws", root);
	const batch = await api.prepare({ terminalId: "draft-term", paths: [source] });
	const ids = batch.entries.map((e) => e.id);
	state = "running";
	try {
		const ready = await api.resolve({ batchId: batch.id, ids, submit: true });
		expect(ready.text).toContain(source);
		for (const unavailable of ["hibernated", "hibernating", "resuming", "needs-input", "error"]) {
			state = unavailable;
			await expect(api.resolve({ batchId: batch.id, ids, submit: true })).rejects.toThrow();
		}
		state = "running";
		expect(
			await api.insert({ batchId: batch.id, text: ready.text, payload: ready.text, submit: true })
		).toBe("admitted");
	} finally {
		state = "idle";
	}
});

test("existing insertion-only daemon remains usable without restarting terminals or sending an unguarded Enter", async () => {
	terminalFileOwners.attach("legacy-term", caller, "ws", root);
	submitCapable = false;
	try {
		const batch = await api.prepare({ terminalId: "legacy-term", paths: [source] });
		state = "running";
		const ready = await api.resolve({
			batchId: batch.id,
			ids: batch.entries.map((e) => e.id),
			submit: true,
		});
		expect(ready.submit).toBe(false);
		expect(
			await api.insert({ batchId: batch.id, text: ready.text, payload: ready.text, submit: true })
		).toBe("admitted");
		expect(writes.at(-1)).toBe(ready.text);
	} finally {
		submitCapable = true;
		state = "idle";
	}
});

test("validated paths can be copied manually without a supported daemon or any PTY input", async () => {
	terminalFileOwners.attach("manual-paths", caller, "ws", root);
	supported = false;
	try {
		const batch = await api.prepare({ terminalId: "manual-paths", paths: [source] });
		const selection = { batchId: batch.id, ids: batch.entries.map((e) => e.id) };
		const before = writes.length;
		await expect(api.resolve(selection)).rejects.toThrow("Copy paths");
		expect(await api.copyPaths(selection)).toBe(` '${source}' `);
		expect(writes).toHaveLength(before);
		await expect(
			terminalFilesRouter
				.createCaller({ fileCaller: { senderId: 45, frameId: 7 } })
				.copyPaths(selection)
		).rejects.toThrow();
		terminalFileOwners.invalidate("manual-paths", "detach");
		await expect(api.copyPaths(selection)).rejects.toThrow();
	} finally {
		supported = true;
	}
});

test("old-service Claude rejection is explained when adding files, retained after append, and never bypasses the guard", async () => {
	terminalFileOwners.attach("old-claude", caller, "ws", root);
	supported = false;
	needsFileInputUpdate = true;
	const before = writes.length;
	try {
		const batch = await api.prepare({ terminalId: "old-claude", paths: [source] });
		expect(batch.inputAvailability).toBe("update-required");
		const next = await api.append({
			batchId: batch.id,
			paths: [source],
			retainedIds: batch.entries.map((e) => e.id),
		});
		expect(next.inputAvailability).toBe("update-required");
		await expect(
			api.resolve({ batchId: batch.id, ids: next.entries.map((e) => e.id), submit: true })
		).rejects.toThrow("restart SuperiorSwarm");
		expect(writes).toHaveLength(before);
		supported = true;
		const codex = await api.prepare({ terminalId: "old-claude", paths: [source] });
		expect(codex.inputAvailability).toBe("ready");
	} finally {
		supported = true;
		needsFileInputUpdate = false;
	}
});

test("insertion-only Enter accepts draft typing state and sends no CR, while sleeping and approval states stay blocked", async () => {
	terminalFileOwners.attach("insert-draft", caller, "ws", root);
	const batch = await api.prepare({ terminalId: "insert-draft", paths: [source] });
	const ids = batch.entries.map((entry) => entry.id);
	state = "running";
	try {
		const prepared = await api.resolve({ batchId: batch.id, ids, submit: false });
		expect(prepared.submit).toBe(false);
		for (const unavailable of ["hibernated", "hibernating", "resuming", "needs-input", "error"]) {
			state = unavailable;
			await expect(api.resolve({ batchId: batch.id, ids, submit: false })).rejects.toThrow();
		}
		state = "running";
		expect(
			await api.insert({
				batchId: batch.id,
				text: prepared.text,
				payload: prepared.text,
				submit: false,
			})
		).toBe("admitted");
		expect(writes.at(-1)).toBe(prepared.text);
		expect(writes.at(-1)).not.toContain("\r");
	} finally {
		state = "idle";
	}
});
