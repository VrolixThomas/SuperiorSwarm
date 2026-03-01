import { BrowserWindow, ipcMain } from "electron";
import { terminalManager } from "./manager";

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
}

export function setupTerminalIPC(): void {
	ipcMain.handle("terminal:create", (event, id: unknown, cwd: unknown) => {
		assertNonEmptyString(id, "id");
		const cwdStr = typeof cwd === "string" && cwd.length > 0 ? cwd : undefined;
		if (terminalManager.has(id)) {
			throw new Error(`Terminal with id "${id}" already exists`);
		}

		const window = BrowserWindow.fromWebContents(event.sender);
		if (!window) return;

		try {
			terminalManager.create(
				id,
				(data) => {
					if (!window.isDestroyed()) {
						window.webContents.send("terminal:data", id, data);
					}
				},
				(exitCode) => {
					if (!window.isDestroyed()) {
						window.webContents.send("terminal:exit", id, exitCode);
					}
				},
				cwdStr
			);
		} catch (error) {
			console.error(`Failed to create terminal ${id}:`, error);
			throw error;
		}
	});

	ipcMain.handle("terminal:write", (_event, id: unknown, data: unknown) => {
		assertNonEmptyString(id, "id");
		if (typeof data !== "string") {
			throw new Error("data must be a string");
		}
		terminalManager.write(id, data);
	});

	ipcMain.handle("terminal:resize", (_event, id: unknown, cols: unknown, rows: unknown) => {
		assertNonEmptyString(id, "id");
		if (!Number.isInteger(cols) || (cols as number) < 1 || (cols as number) > 500) {
			throw new Error("cols must be an integer between 1 and 500");
		}
		if (!Number.isInteger(rows) || (rows as number) < 1 || (rows as number) > 500) {
			throw new Error("rows must be an integer between 1 and 500");
		}
		terminalManager.resize(id, cols as number, rows as number);
	});

	ipcMain.handle("terminal:dispose", (_event, id: unknown) => {
		assertNonEmptyString(id, "id");
		terminalManager.dispose(id);
	});
}
