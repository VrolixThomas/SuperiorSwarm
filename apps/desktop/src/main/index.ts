import { join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { initializeDatabase } from "./db";
import {
	type SessionSaveData,
	saveTerminalSessions,
} from "./db/session-persistence";
import { setupTerminalIPC } from "./terminal/ipc";
import { terminalManager } from "./terminal/manager";
import { setupTRPCIPC } from "./trpc/ipc-link";
import { appRouter } from "./trpc/routers";

let mainWindow: BrowserWindow | null = null;

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 800,
		minHeight: 600,
		show: false,
		titleBarStyle: "hiddenInset",
		trafficLightPosition: { x: 16, y: 18 },
		webPreferences: {
			preload: join(__dirname, "../preload/index.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	mainWindow.on("ready-to-show", () => {
		mainWindow?.show();
	});

	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	if (process.env["ELECTRON_RENDERER_URL"]) {
		mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

app.whenReady().then(() => {
	setupTerminalIPC();
	try {
		initializeDatabase();
	} catch (err) {
		console.error("[db] Failed to initialize database:", err);
		dialog.showErrorBoxSync(
			"Database Error",
			`BranchFlux failed to initialize its database and cannot start.\n\n${String(err)}`,
		);
		app.quit();
		return;
	}
	setupTRPCIPC(appRouter);

	ipcMain.on(
		"terminal-sessions:save-sync",
		(event, data: SessionSaveData) => {
			try {
				saveTerminalSessions(data);
				event.returnValue = { ok: true };
			} catch (err) {
				console.error("Failed to save terminal sessions on quit:", err);
				event.returnValue = { ok: false };
			}
		}
	);

	ipcMain.handle("shell:openExternal", async (_event, url: string) => {
		if (typeof url === "string" && (url.startsWith("https://") || url.startsWith("http://"))) {
			await shell.openExternal(url);
		}
	});

	ipcMain.handle("dialog:openDirectory", async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openDirectory", "multiSelections"],
		});
		if (result.canceled) return null;
		return result.filePaths;
	});

	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("before-quit", () => {
	terminalManager.disposeAll();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

// When electron-vite dev server stops or restarts, the Electron process receives
// a signal but has no handler, so it exits without cleaning up node-pty's native
// ThreadSafeFunctions. During Node's environment teardown those callbacks fire and
// call Napi::Error::ThrowAsJavaScriptException() which is illegal at that point,
// causing SIGABRT and a macOS "quit unexpectedly" crash dialog on the next launch.
// Catching the signals lets us dispose PTY processes before the environment tears down.
for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
	process.on(signal, () => {
		terminalManager.disposeAll();
		app.exit(0);
	});
}
