import { homedir } from "node:os";
import { eq } from "drizzle-orm";
import { BrowserWindow, ipcMain } from "electron";
import type { TerminalDataMeta } from "../../shared/daemon-protocol";
import {
	TerminalCreateError,
	type TerminalCreateResult,
	terminalCreateFailure,
} from "../../shared/terminal-create";
import { WorkspaceError } from "../../shared/workspace-errors";
import { getAgentNotifyPort, getAgentNotifyToken } from "../agent-hooks/port";
import {
	canonicalWorkspaceDirectory,
	getWorkspaceCwdOrThrow,
} from "../agent-launch/workspace-cwd-lookup";
import { getDb } from "../db";
import { terminalSessions } from "../db/schema";
import { ensureTerminalSessionRow } from "../db/session-persistence";
import type { AgentSessionManager } from "../services/agent-session-manager";
import { incrementCounter } from "../telemetry/state";
import type { DaemonClient } from "./daemon-client";
import { registerTerminalInputIPC } from "./input-ipc";
import { rendererTrust } from "./renderer-trust";
import { type FileCaller, terminalFileOwners } from "./terminal-files";

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
		async (
			event,
			id: unknown,
			_cwd: unknown,
			workspaceId: unknown
		): Promise<TerminalCreateResult> => {
			let insertedSessionRow = false;
			let owner: ReturnType<typeof terminalFileOwners.attach> | undefined;
			try {
				assertNonEmptyString(id, "id");
				if (daemonClient.quitting) return { wasAttached: false };
				const window = BrowserWindow.fromWebContents(event.sender);
				if (!window) throw new TerminalCreateError("TERMINAL_NOT_AUTHORIZED");
				let caller: FileCaller;
				try {
					caller = rendererTrust.authorize({
						id: event.sender.id,
						url: event.senderFrame?.url ?? "",
						frameId: event.senderFrame?.routingId ?? -1,
						mainFrameId: event.sender.mainFrame.routingId,
						destroyed: event.sender.isDestroyed(),
					});
				} catch {
					throw new TerminalCreateError("TERMINAL_NOT_AUTHORIZED");
				}
				const wsId =
					typeof workspaceId === "string" && workspaceId.length > 0 ? workspaceId : undefined;
				const db = getDb();
				const row = db.select().from(terminalSessions).where(eq(terminalSessions.id, id)).get();
				let wasAttached = daemonClient.hasLiveSession(id);
				if ((row && row.workspaceId !== wsId) || (wasAttached && !row))
					throw new TerminalCreateError("TERMINAL_WORKSPACE_MISMATCH");
				// Renderer cwd is display metadata, never authority to select a root.
				const cwd = wsId ? getWorkspaceCwdOrThrow(wsId) : canonicalWorkspaceDirectory(homedir());
				if (row && canonicalWorkspaceDirectory(row.cwd) !== cwd)
					throw new WorkspaceError("WORKSPACE_ROOT_CHANGED");
				if (wsId) {
					owner = terminalFileOwners.attach(id, caller, wsId, cwd);
				}
				if (wasAttached) {
					const sessions = await daemonClient.listSessionsStrict();
					const live = sessions.find((session) => session.id === id);
					if (live && canonicalWorkspaceDirectory(live.cwd) !== cwd)
						throw new WorkspaceError("WORKSPACE_ROOT_CHANGED");
					wasAttached = Boolean(live);
				}
				// The daemon inventory query yields. Recheck both record identity and
				// the directory inode before handing the bound root to the daemon.
				if (wsId && owner) {
					if (getWorkspaceCwdOrThrow(wsId) !== cwd)
						throw new WorkspaceError("WORKSPACE_ROOT_CHANGED");
					try {
						owner.assertCurrent();
					} catch {
						throw new WorkspaceError("WORKSPACE_ROOT_CHANGED");
					}
					const current = db
						.select()
						.from(terminalSessions)
						.where(eq(terminalSessions.id, id))
						.get();
					if (row && (!current || current.workspaceId !== wsId || current.cwd !== row.cwd))
						throw new TerminalCreateError("TERMINAL_WORKSPACE_MISMATCH");
					insertedSessionRow = ensureTerminalSessionRow({ id, workspaceId: wsId, cwd });
				}
				const onData = (data: string, meta?: TerminalDataMeta) => {
					if (meta?.replay) terminalFileOwners.invalidate(id, "replay");
					if (!window.isDestroyed()) window.webContents.send("terminal:data", id, data, meta);
				};
				const onExit = (exitCode: number) => {
					terminalFileOwners.detach(id);
					if (!window.isDestroyed()) window.webContents.send("terminal:exit", id, exitCode);
				};
				const notifyPort = getAgentNotifyPort();
				const notifyToken = getAgentNotifyToken();
				const env: Record<string, string> = {
					AGENT_NOTIFY_TERMINAL_ID: id,
					AGENT_NOTIFY_SESSION_ID: id,
				};
				if (notifyPort) env["AGENT_NOTIFY_PORT"] = String(notifyPort);
				if (wsId) env["AGENT_NOTIFY_WORKSPACE_ID"] = wsId;
				if (notifyToken) env["AGENT_NOTIFY_TOKEN"] = notifyToken;
				if (wasAttached) {
					await daemonClient.attach(id, onData, onExit, cwd, env);
				} else {
					await daemonClient.create(id, cwd, onData, onExit, env);
					incrementCounter(db, "lifetimeSessionsStarted");
				}
				return { wasAttached };
			} catch (error) {
				if (typeof id === "string") {
					owner?.rollback();
					if (insertedSessionRow)
						getDb().delete(terminalSessions).where(eq(terminalSessions.id, id)).run();
				}
				console.error("Failed to create/attach terminal:", { id, workspaceId, error });
				return terminalCreateFailure(error);
			}
		}
	);

	const input = registerTerminalInputIPC(
		ipcMain,
		daemonClient,
		(id) => agentSessionManager?.beforeTerminalInput(id) ?? Promise.resolve(),
		(id, data, binary) => {
			if (!binary && /[\r\n]/.test(data)) terminalFileOwners.invalidate(id, "submitted input");
		}
	);

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
		input.invalidate(id);
		daemonClient.detach(id);
	});

	ipcMain.handle("terminal:dispose", (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		terminalFileOwners.detach(id);
		input.invalidate(id);
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
		if (!connected) input.clear();
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
