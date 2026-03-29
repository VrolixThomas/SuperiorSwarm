import { join } from "node:path";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { daemonInstanceId, daemonPaths } from "../shared/daemon-protocol";
import { cleanupReviewWorkspace, findReviewWorkspaceByPR } from "./ai-review/cleanup";
import { startCommentPoller, stopCommentPoller } from "./ai-review/comment-poller";
import { startPolling } from "./ai-review/commit-poller";
import { cleanupStaleReviews } from "./ai-review/orchestrator";
import {
	onNewPRDetected,
	onPRClosedDetected,
	startPolling as startPRPolling,
} from "./ai-review/pr-poller";
import { getDb, initializeDatabase } from "./db";
import * as schema from "./db/schema";
import {
	type SessionSaveData,
	savePaneLayouts,
	saveTerminalSessions,
} from "./db/session-persistence";
import { setupLspIPC } from "./lsp/ipc-handler";
import { serverManager } from "./lsp/server-manager";
import { DaemonClient } from "./terminal/daemon-client";
import { setDaemonClient } from "./terminal/daemon-instance";
import { setupTerminalIPC } from "./terminal/ipc";
import { setupTRPCIPC } from "./trpc/ipc-link";
import { appRouter } from "./trpc/routers";

let mainWindow: BrowserWindow | null = null;
let daemonClient: DaemonClient;

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

app.whenReady().then(async () => {
	const instanceId = daemonInstanceId(__dirname);
	const paths = daemonPaths(instanceId);
	daemonClient = new DaemonClient(paths.socketPath, paths.pidPath, paths.logPath);
	setDaemonClient(daemonClient);

	setupTerminalIPC(daemonClient);
	try {
		initializeDatabase();
	} catch (err) {
		console.error("[db] Failed to initialize database:", err);
		dialog.showErrorBox(
			"Database Error",
			`BranchFlux failed to initialize its database and cannot start.\n\n${String(err)}`
		);
		app.quit();
		return;
	}
	cleanupStaleReviews();
	startPolling();
	startPRPolling();
	startCommentPoller();

	onNewPRDetected((pr) => {
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("new-pr-review-request", pr);
		}
	});

	onPRClosedDetected(async (pr) => {
		const wsId = findReviewWorkspaceByPR(pr.provider, pr.identifier);
		if (wsId) {
			await cleanupReviewWorkspace(wsId);
		}
		for (const win of BrowserWindow.getAllWindows()) {
			win.webContents.send("pr-closed", pr);
		}
	});

	// Clear ephemeral terminal IDs (reset across sessions)
	{
		const db = getDb();
		db.update(schema.workspaces).set({ terminalId: null, updatedAt: new Date() }).run();
	}
	const dbPath = join(app.getPath("userData"), "branchflux.db");
	const daemonScriptPath = join(app.getAppPath(), "out", "main", "daemon.js");
	try {
		await daemonClient.connect(dbPath, daemonScriptPath);
	} catch (err) {
		console.error("[main] Failed to connect to terminal daemon, will retry:", err);
		daemonClient.startReconnecting();
	}
	setupTRPCIPC(appRouter);

	ipcMain.on("terminal-sessions:save-sync", (event, data: SessionSaveData) => {
		try {
			saveTerminalSessions(data);
			if (data.paneLayouts) {
				savePaneLayouts(data.paneLayouts);
			}
			event.returnValue = { ok: true };
		} catch (err) {
			console.error("Failed to save terminal sessions on quit:", err);
			event.returnValue = { ok: false };
		}
	});

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

	ipcMain.handle(
		"dialog:openFile",
		async (
			_event,
			options?: {
				defaultPath?: string;
				filters?: Array<{ name: string; extensions: string[] }>;
			}
		) => {
			const result = await dialog.showOpenDialog({
				properties: ["openFile"],
				defaultPath: options?.defaultPath,
				filters: options?.filters ?? [{ name: "All Files", extensions: ["*"] }],
			});
			if (result.canceled || result.filePaths.length === 0) return null;
			return result.filePaths[0] ?? null;
		}
	);

	createWindow();

	if (mainWindow) {
		setupLspIPC(mainWindow);
	}

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("before-quit", () => {
	stopCommentPoller();
	daemonClient.setQuitting();
	daemonClient.detachAll();
	serverManager.disposeAll();
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
		daemonClient.setQuitting();
		daemonClient.detachAll();
		serverManager.disposeAll();
		app.exit(0);
	});
}
