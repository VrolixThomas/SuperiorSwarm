import { BrowserWindow, ipcMain } from "electron";
import type { DaemonClient } from "./daemon-client";

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
}

export function setupTerminalIPC(daemonClient: DaemonClient): void {
	ipcMain.handle("terminal:create", async (event, id: unknown, cwd: unknown) => {
		assertNonEmptyString(id, "id");
		const cwdStr = typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;

		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) return { wasAttached: false };

		const onData = (data: string) => {
			if (!window.isDestroyed()) {
				window.webContents.send("terminal:data", id, data);
			}
		};
		const onExit = (exitCode: number) => {
			if (!window.isDestroyed()) {
				window.webContents.send("terminal:exit", id, exitCode);
			}
		};

		try {
			if (daemonClient.hasLiveSession(id)) {
				await daemonClient.attach(id, onData, onExit, cwdStr);
				return { wasAttached: true };
			}
			await daemonClient.create(id, cwdStr, onData, onExit);
			return { wasAttached: false };
		} catch (error) {
			console.error(`Failed to create/attach terminal ${id}:`, error);
			throw error;
		}
	});

	ipcMain.handle("terminal:write", (_event, id: unknown, data: unknown) => {
		assertNonEmptyString(id, "id");
		if (typeof data !== "string") {
			throw new Error("data must be a string");
		}
		daemonClient.write(id, data);
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

	ipcMain.handle("terminal:dispose", (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		daemonClient.dispose(id);
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

	daemonClient.setConnectionStatusCallback((connected: boolean) => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send("daemon:status", connected);
			}
		}
	});
}
