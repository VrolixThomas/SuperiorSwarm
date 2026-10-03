import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { BrowserWindow, ipcMain } from "electron";
import type { TerminalDataMeta } from "../../shared/daemon-protocol";
import { getAgentNotifyPort, getAgentNotifyToken } from "../agent-hooks/port";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";
import { getDb } from "../db";
import { terminalSessions } from "../db/schema";
import { ensureTerminalSessionRow } from "../db/session-persistence";
import type { AgentSessionManager } from "../services/agent-session-manager";
import { incrementCounter } from "../telemetry/state";
import type { DaemonClient } from "./daemon-client";
import { rendererTrust } from "./renderer-trust";
import { terminalFileOwners } from "./terminal-files";

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
}

export function setupTerminalIPC(
	daemonClient: DaemonClient,
	agentSessionManager?: AgentSessionManager
): void {
	ipcMain.handle(
		"terminal:create",
		async (event, id: unknown, cwd: unknown, workspaceId: unknown) => {
			assertNonEmptyString(id, "id");
			// During quit the renderer may still resolve an in-flight session
			// restore and fire terminal:create after we have already detached from
			// the daemon. Short-circuit so it does not throw "Daemon not connected".
			if (daemonClient.quitting) return { wasAttached: false };
			const cwdStr = typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
			const wsId = typeof workspaceId === "string" ? workspaceId : undefined;
			const persistedCwd = cwdStr ?? homedir();

			const window = BrowserWindow.fromWebContents(event.sender);
			if (!window) return { wasAttached: false };
			const insertedSessionRow = wsId
				? ensureTerminalSessionRow({
						id,
						workspaceId: wsId,
						cwd: persistedCwd,
					})
				: false;

			const caller = rendererTrust.authorize({
				id: event.sender.id,
				url: event.senderFrame?.url ?? "",
				frameId: event.senderFrame?.routingId ?? -1,
				mainFrameId: event.sender.mainFrame.routingId,
				destroyed: event.sender.isDestroyed(),
			});
			const row = getDb().select().from(terminalSessions).where(eq(terminalSessions.id, id)).get();
			if (row?.workspaceId && row.workspaceId !== wsId)
				throw new Error("Terminal workspace mismatch.");
			if (row?.workspaceId)
				terminalFileOwners.attach(
					id,
					caller,
					row.workspaceId,
					realpathSync(getWorkspaceCwdOrThrow(row.workspaceId))
				);

			const onData = (data: string, meta?: TerminalDataMeta) => {
				if (meta?.replay) terminalFileOwners.invalidate(id, "replay");
				if (!window.isDestroyed()) {
					window.webContents.send("terminal:data", id, data, meta);
				}
			};
			const onExit = (exitCode: number) => {
				terminalFileOwners.detach(id);
				if (!window.isDestroyed()) {
					window.webContents.send("terminal:exit", id, exitCode);
				}
			};

			const notifyPort = getAgentNotifyPort();
			const notifyToken = getAgentNotifyToken();
			const env: Record<string, string> = {
				AGENT_NOTIFY_TERMINAL_ID: id,
				// Legacy alias retained for existing generated hook scripts.
				AGENT_NOTIFY_SESSION_ID: id,
			};
			if (notifyPort) {
				env["AGENT_NOTIFY_PORT"] = String(notifyPort);
			}
			if (wsId) {
				env["AGENT_NOTIFY_WORKSPACE_ID"] = wsId;
			}
			if (notifyToken) {
				env["AGENT_NOTIFY_TOKEN"] = notifyToken;
			}

			try {
				if (daemonClient.hasLiveSession(id)) {
					await daemonClient.attach(id, onData, onExit, cwdStr, env);
					return { wasAttached: true };
				}
				await daemonClient.create(id, cwdStr, onData, onExit, env);
				incrementCounter(getDb(), "lifetimeSessionsStarted");
				return { wasAttached: false };
			} catch (error) {
				if (insertedSessionRow) {
					getDb().delete(terminalSessions).where(eq(terminalSessions.id, id)).run();
				}
				console.error(`Failed to create/attach terminal ${id}:`, error);
				throw error;
			}
		}
	);

	ipcMain.handle("terminal:write", async (_event, id: unknown, data: unknown) => {
		assertNonEmptyString(id, "id");
		if (typeof data !== "string") {
			throw new Error("data must be a string");
		}
		if (/[\r\n]/.test(data)) terminalFileOwners.invalidate(id, "submitted input");
		await agentSessionManager?.beforeTerminalInput(id);
		// false = daemon not connected, nothing delivered. Callers that need
		// delivery confirmation (e.g. inline-comment send) check this; the
		// keystroke path ignores it.
		return daemonClient.write(id, data);
	});

	ipcMain.handle("terminal:resize", (_event, id: unknown, cols: unknown, rows: unknown) => {
		assertNonEmptyString(id, "id");
		if (!Number.isInteger(cols) || (cols as number) < 1 || (cols as number) > 500) {
			throw new Error("cols must be an integer between 1 and 500");
		}
		if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > 500) {
			throw new Error("rows must be an integer between 1 and 500");
		}
		daemonClient.resize(id, cols as number, rows as number);
	});

	ipcMain.handle("terminal:detach", (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		terminalFileOwners.detach(id);
		daemonClient.detach(id);
	});

	ipcMain.handle("terminal:dispose", (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		terminalFileOwners.detach(id);
		daemonClient.dispose(id);
		agentSessionManager?.removeSession(id);
		// Also remove the DB session record so it doesn't reappear as stale
		try {
			const db = getDb();
			db.delete(terminalSessions).where(eq(terminalSessions.id, id)).run();
		} catch {
			// DB may not be initialized yet during early startup
		}
	});

	ipcMain.handle("terminal:set-visible", async (_event, id: unknown, visible: unknown) => {
		assertNonEmptyString(id, "id");
		if (typeof visible !== "boolean") {
			throw new Error("visible must be a boolean");
		}
		if (!visible) terminalFileOwners.invalidate(id, "hidden");
		await agentSessionManager?.setVisible(id, visible);
	});

	ipcMain.handle("terminal:wake", async (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		terminalFileOwners.invalidate(id, "wake");
		await agentSessionManager?.wake(id);
	});

	ipcMain.handle("daemon:status", () => {
		return daemonClient.isConnected;
	});

	ipcMain.handle("daemon:listSessions", async () => {
		const daemonSessions = await daemonClient.listSessions();
		const liveSessions = Array.from(daemonClient.getLiveSessions());
		const callbackIds = daemonClient.getCallbackIds();
		return { daemonSessions, liveSessions, callbackIds };
	});

	daemonClient.addConnectionStatusListener((connected: boolean) => {
		terminalFileOwners.invalidateAll();
		if (connected && agentSessionManager) {
			void agentSessionManager.reconcile().catch((error) => {
				console.error("[agent-session] failed to reconcile terminal processes:", error);
			});
		}
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send("daemon:status", connected);
			}
		}
	});
}
