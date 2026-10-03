import { contextBridge, ipcRenderer, webUtils } from "electron";
import { resolveNativeFiles } from "../../../src/preload/terminal-files";

const listen = (channel: string, id: string, callback: (...args: unknown[]) => void) => {
	const handler = (_event: unknown, target: string, ...args: unknown[]) => {
		if (target === id) callback(...args);
	};
	ipcRenderer.on(channel, handler);
	return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld("electron", {
	terminalFiles: {
		nativePaths: (files: File[]) => resolveNativeFiles(files, webUtils.getPathForFile),
	},
	fixtureFiles: (method: string, input: unknown) =>
		ipcRenderer.invoke("fixture:files", method, input),
	shell: { openExternal: async () => {} },
	daemon: { onStatus: () => () => {} },
	terminal: {
		create: (id: string) => ipcRenderer.invoke("fixture:create", id),
		write: (id: string, data: string) => ipcRenderer.invoke("fixture:write", id, data),
		resize: (id: string, cols: number, rows: number) =>
			ipcRenderer.invoke("fixture:resize", id, cols, rows),
		setVisible: async () => {},
		detach: async () => {},
		onData: (id: string, callback: (...args: unknown[]) => void) =>
			listen("fixture:data", id, callback),
		onExit: (id: string, callback: (...args: unknown[]) => void) =>
			listen("fixture:exit", id, callback),
	},
});
