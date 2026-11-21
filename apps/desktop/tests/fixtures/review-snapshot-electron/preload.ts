import { contextBridge, ipcRenderer } from "electron";
const calls: { type: string; path: string }[] = [];
contextBridge.exposeInMainWorld("electron", {
	trpc: {
		request: (request: { type: string; path: string; input: unknown }) => {
			if (request.type !== "query" || !request.path.startsWith("reviewExplanation."))
				throw new Error("Fixture prohibits non-snapshot reads and all writes");
			calls.push({ type: request.type, path: request.path });
			return ipcRenderer.invoke("trpc:request", request);
		},
	},
});
contextBridge.exposeInMainWorld("snapshotFixture", {
	complete: (result: unknown) => ipcRenderer.invoke("fixture:complete", { result, calls }),
});
