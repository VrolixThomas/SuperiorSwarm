import { contextBridge, ipcRenderer } from "electron";
// Real contextBridge/invoke transport. The fixture main registers only isolated handlers.
contextBridge.exposeInMainWorld("electron", {
	trpc: { request: (request: unknown) => ipcRenderer.invoke("trpc:request", request) },
	lsp: {
		onNotification: () => () => {},
		onServerStatus: () => () => {},
		sendRequest: async () => null,
		sendNotification: () => {},
	},
	terminal: {
		onData: () => () => {},
		onExit: () => () => {},
		onTitle: () => () => {},
		onCwd: () => () => {},
		onProcessChange: () => () => {},
		onAgentStatus: () => () => {},
		write: () => ipcRenderer.invoke("fixture:forbidden", "terminal.write"),
	},
});
contextBridge.exposeInMainWorld("validation", {
	control: (command: string, value?: unknown) =>
		ipcRenderer.invoke("fixture:control", command, value),
	capture: (name: string) => ipcRenderer.invoke("fixture:capture", name),
	input: (event: unknown) => ipcRenderer.invoke("fixture:input", event),
	complete: (value: unknown) => ipcRenderer.invoke("fixture:complete", value),
});
