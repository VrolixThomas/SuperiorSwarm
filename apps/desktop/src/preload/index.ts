import { contextBridge, ipcRenderer } from "electron";
import type { DialogAPI, SessionAPI, SessionSaveData, TerminalAPI, TrpcAPI } from "../shared/types";

function createDispatcher<T extends unknown[]>(channel: string) {
	const listeners = new Map<string, (...args: T) => void>();
	ipcRenderer.on(channel, (_event: Electron.IpcRendererEvent, id: string, ...args: T) => {
		listeners.get(id)?.(...args);
	});
	return {
		add(id: string, callback: (...args: T) => void): () => void {
			listeners.set(id, callback);
			return () => listeners.delete(id);
		},
	};
}

const dataDispatcher = createDispatcher<[string]>("terminal:data");
const exitDispatcher = createDispatcher<[number]>("terminal:exit");

const terminalAPI: TerminalAPI = {
	create: (id: string, cwd?: string) => ipcRenderer.invoke("terminal:create", id, cwd),
	write: (id: string, data: string) => ipcRenderer.invoke("terminal:write", id, data),
	resize: (id: string, cols: number, rows: number) =>
		ipcRenderer.invoke("terminal:resize", id, cols, rows),
	dispose: (id: string) => ipcRenderer.invoke("terminal:dispose", id),
	onData: (id: string, callback: (data: string) => void) => dataDispatcher.add(id, callback),
	onExit: (id: string, callback: (exitCode: number) => void) => exitDispatcher.add(id, callback),
};

const trpcAPI: TrpcAPI = {
	request: (opts) => ipcRenderer.invoke("trpc:request", opts),
};

const dialogAPI: DialogAPI = {
	openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
};

const sessionAPI: SessionAPI = {
	saveSync: (data: SessionSaveData) =>
		ipcRenderer.sendSync("terminal-sessions:save-sync", data) as { ok: boolean },
};

contextBridge.exposeInMainWorld("electron", {
	terminal: terminalAPI,
	trpc: trpcAPI,
	dialog: dialogAPI,
	session: sessionAPI,
});
