import { contextBridge, ipcRenderer } from "electron";
import type {
	DaemonAPI,
	DialogAPI,
	LspAPI,
	SessionAPI,
	SessionSaveData,
	ShellAPI,
	TerminalAPI,
	TrpcAPI,
} from "../shared/types";

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
	detach: (id: string) => ipcRenderer.invoke("terminal:detach", id),
	dispose: (id: string) => ipcRenderer.invoke("terminal:dispose", id),
	onData: (id: string, callback: (data: string) => void) => dataDispatcher.add(id, callback),
	onExit: (id: string, callback: (exitCode: number) => void) => exitDispatcher.add(id, callback),
};

const trpcAPI: TrpcAPI = {
	request: (opts) => ipcRenderer.invoke("trpc:request", opts),
};

const dialogAPI: DialogAPI = {
	openDirectory: () => ipcRenderer.invoke("dialog:openDirectory"),
	openFile: (options) => ipcRenderer.invoke("dialog:openFile", options),
};

const sessionAPI: SessionAPI = {
	saveSync: (data: SessionSaveData) =>
		ipcRenderer.sendSync("terminal-sessions:save-sync", data) as { ok: boolean },
};

const shellAPI: ShellAPI = {
	openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
};

const lspAPI: LspAPI = {
	sendRequest: (opts) => ipcRenderer.invoke("lsp:request", opts),
	sendNotification: (opts) => ipcRenderer.send("lsp:notification", opts),
	onNotification: (callback) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			serverId: string,
			method: string,
			params: unknown
		) => {
			callback(serverId, method, params);
		};
		ipcRenderer.on("lsp:notification-from-server", handler);
		return () => ipcRenderer.removeListener("lsp:notification-from-server", handler);
	},
	onServerRestarted: (callback) => {
		const handler = (
			_event: Electron.IpcRendererEvent,
			configId: string,
			repoPath: string,
			uris: string[]
		) => {
			callback(configId, repoPath, uris);
		};
		ipcRenderer.on("lsp:server-restarted", handler);
		return () => ipcRenderer.removeListener("lsp:server-restarted", handler);
	},
};

const daemonAPI: DaemonAPI = {
	getStatus: () => ipcRenderer.invoke("daemon:status"),
	onStatus: (callback: (connected: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, connected: boolean) => callback(connected);
		ipcRenderer.on("daemon:status", listener);
		return () => {
			ipcRenderer.removeListener("daemon:status", listener);
		};
	},
	listSessions: () => ipcRenderer.invoke("daemon:listSessions"),
};

contextBridge.exposeInMainWorld("electron", {
	terminal: terminalAPI,
	trpc: trpcAPI,
	dialog: dialogAPI,
	session: sessionAPI,
	shell: shellAPI,
	lsp: lspAPI,
	daemon: daemonAPI,
});
