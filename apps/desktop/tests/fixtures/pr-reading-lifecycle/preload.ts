import { contextBridge, ipcRenderer } from "electron";
const calls: { path: string; type: string }[] = [];
contextBridge.exposeInMainWorld("electron", {
	trpc: {
		request: (request: { path: string; type: string }) => {
			if (!request.path.startsWith("reviewPath."))
				throw Error("Fixture restricts RPC to reading paths");
			calls.push({ path: request.path, type: request.type });
			return ipcRenderer.invoke("trpc:request", request);
		},
	},
});
contextBridge.exposeInMainWorld("lifecycleFixture", {
	command: (action: string, input: unknown) => ipcRenderer.invoke("fixture:command", action, input),
	attach: (id: string) => ipcRenderer.invoke("terminal:create", id, undefined, "w"),
	complete: (result: unknown) => ipcRenderer.invoke("fixture:complete", { result, calls }),
});
