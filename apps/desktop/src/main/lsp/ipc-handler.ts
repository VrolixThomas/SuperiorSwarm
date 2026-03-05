import { type BrowserWindow, ipcMain } from "electron";
import { serverManager } from "./server-manager";

export function setupLspIPC(mainWindow: BrowserWindow): void {
	serverManager.setMainWindow(mainWindow);

	// Handle LSP requests (request-response pattern)
	ipcMain.handle(
		"lsp:request",
		async (
			_event,
			{
				languageId,
				repoPath,
				method,
				params,
			}: { languageId: string; repoPath: string; method: string; params: unknown }
		) => {
			const config = serverManager.findConfig(languageId);
			if (!config) return { error: `No language server for ${languageId}` };

			const connection = await serverManager.getOrCreate(config.id, repoPath);
			if (!connection) return { error: `Failed to start ${config.id} server` };

			try {
				const result = await Promise.race([
					connection.sendRequest(method, params),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error("LSP request timeout")), 10000)
					),
				]);
				return { result };
			} catch (err) {
				return { error: err instanceof Error ? err.message : "Unknown error" };
			}
		}
	);

	// Handle LSP notifications (fire-and-forget)
	ipcMain.on(
		"lsp:notification",
		(
			_event,
			{
				languageId,
				repoPath,
				method,
				params,
			}: { languageId: string; repoPath: string; method: string; params: unknown }
		) => {
			const config = serverManager.findConfig(languageId);
			if (!config) return;

			const connection = serverManager.getConnection(config.id, repoPath);
			if (!connection) return;

			connection.sendNotification(method, params);

			// Track document opens/closes
			if (
				method === "textDocument/didOpen" &&
				params &&
				typeof params === "object" &&
				"textDocument" in params
			) {
				const td = (params as { textDocument: { uri: string } }).textDocument;
				serverManager.trackDocument(config.id, repoPath, td.uri);
			}
			if (
				method === "textDocument/didClose" &&
				params &&
				typeof params === "object" &&
				"textDocument" in params
			) {
				const td = (params as { textDocument: { uri: string } }).textDocument;
				serverManager.untrackDocument(config.id, repoPath, td.uri);
			}
		}
	);
}
