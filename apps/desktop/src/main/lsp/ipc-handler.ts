import { type BrowserWindow, ipcMain } from "electron";
import type { LspSupportResponse } from "../../shared/types";
import { isCloneable } from "../ipc-safety";
import { log } from "../logger";
import { serverManager } from "./server-manager";

export function setupLspIPC(mainWindow: BrowserWindow): void {
	serverManager.setMainWindow(mainWindow);

	ipcMain.handle(
		"lsp:getSupport",
		async (
			_event,
			{ repoPath, languageId, filePath }: { repoPath: string; languageId: string; filePath: string }
		): Promise<LspSupportResponse> => {
			const support = serverManager.getSupport(repoPath, languageId, filePath);
			if (!support.supported) {
				const reason = support.reason;
				return {
					supported: false,
					reason,
				};
			}

			return {
				supported: true,
				serverId: support.config.id,
				reason: support.reason,
			};
		}
	);

	ipcMain.handle("lsp:getHealth", async (_event, { repoPath }: { repoPath: string }) => {
		return {
			entries: serverManager.getHealth(repoPath),
		};
	});

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
			const label = `lsp:${method}`;

			const config = serverManager.findConfig(languageId, repoPath);
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
				if (!isCloneable(result, label)) {
					return { error: `LSP response for ${method} cannot be serialized` };
				}
				log.info(`[ipc] sending ${label}`);
				return { result };
			} catch (err) {
				return { error: err instanceof Error ? err.message : "Unknown error" };
			}
		}
	);

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
			const config = serverManager.findConfig(languageId, repoPath);
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
