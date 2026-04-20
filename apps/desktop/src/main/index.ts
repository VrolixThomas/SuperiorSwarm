import { join } from "node:path";
import { eq } from "drizzle-orm";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { AGENT_NOTIFY_PORT } from "../shared/agent-events";
import { daemonInstanceId, daemonPaths } from "../shared/daemon-protocol";
import { updateOpenCodePluginPort } from "./agent-hooks/agents/opencode";
import { type AgentAlertListener, createAlertListener, reclaimPort } from "./agent-hooks/listener";
import { setAgentNotifyPort } from "./agent-hooks/port";
import { setupAgentHooks } from "./agent-hooks/setup";
import { maybeAutoReReview, maybeAutoTriggerReview } from "./ai-review/auto-trigger";
import { cleanupReviewWorkspace, findReviewWorkspaceByPR } from "./ai-review/cleanup";
import { startCommentPoller, stopCommentPoller } from "./ai-review/comment-poller";
import { recoverStuckSessions } from "./ai-review/comment-solver-orchestrator";
import { startPolling } from "./ai-review/commit-poller";
import { cleanupStaleReviews } from "./ai-review/orchestrator";
import {
	onNewPRDetected,
	onPRClosedDetected,
	onPRCommitChanged,
	startPolling as startPRPolling,
} from "./ai-review/pr-poller";
import { backfillRemoteHosts, getDb, initializeDatabase } from "./db";
import * as schema from "./db/schema";
import {
	type SessionSaveData,
	savePaneLayouts,
	saveTerminalSessions,
} from "./db/session-persistence";
import { isCloneable, setDebugMode } from "./ipc-safety";
import { log, setupCrashHandlers } from "./logger";
import { setupLspIPC } from "./lsp/ipc-handler";
import { serverManager, warmShellPathCache } from "./lsp/server-manager";
import { syncShortcuts } from "./quick-actions/shortcuts";
import { registerSingleInstance } from "./single-instance";
import { ensureTelemetryState } from "./telemetry/state";
import { DaemonClient } from "./terminal/daemon-client";
import { setDaemonClient } from "./terminal/daemon-instance";
import { setupTerminalIPC } from "./terminal/ipc";
import { cleanupStaleDaemons } from "./terminal/stale-daemon-cleanup";
import { setupTRPCIPC } from "./trpc/ipc-link";
import { appRouter } from "./trpc/routers";
import { listQuickActions } from "./trpc/routers/quick-actions";
import { initializeUpdater, teardownUpdater } from "./updater";

import { BitbucketAdapter } from "./providers/bitbucket-adapter";
import { registerGitProvider } from "./providers/git-provider";
import { GitHubAdapter } from "./providers/github-adapter";
import { registerIssueTracker } from "./providers/issue-tracker";
import { JiraAdapter } from "./providers/jira-adapter";
import { LinearAdapter } from "./providers/linear-adapter";

let mainWindow: BrowserWindow | null = null;
let daemonClient: DaemonClient;
let alertListener: AgentAlertListener | null = null;

function isHttpUrl(url: string): boolean {
	return url.startsWith("http://") || url.startsWith("https://");
}

if (!import.meta.env.DEV && !registerSingleInstance(app, () => mainWindow)) {
	process.exit(0);
}

function broadcastToWindows(channel: string, payload: unknown): void {
	if (!isCloneable(payload, channel)) return;
	log.info(`[ipc] sending ${channel}`);
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) {
			win.webContents.send(channel, payload);
		}
	}
}

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

	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (isHttpUrl(url)) {
			void shell.openExternal(url);
		}
		return { action: "deny" };
	});

	mainWindow.webContents.on("will-navigate", (event, url) => {
		const devURL = process.env["ELECTRON_RENDERER_URL"];
		const isDevURL = Boolean(devURL) && url.startsWith(devURL ?? "");
		if (!isDevURL && !url.startsWith("file://")) {
			event.preventDefault();
			if (isHttpUrl(url)) {
				void shell.openExternal(url);
			}
		}
	});

	if (process.env["ELECTRON_RENDERER_URL"]) {
		mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
	} else {
		mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
	}
}

app.whenReady().then(async () => {
	setupCrashHandlers();
	log.info("App started", { version: app.getVersion() });
	const instanceId = daemonInstanceId(__dirname);
	const paths = daemonPaths(instanceId);
	daemonClient = new DaemonClient(
		paths.socketPath,
		paths.pidPath,
		paths.logPath,
		!app.isPackaged,
		paths.ownerPath,
		instanceId
	);
	setDaemonClient(daemonClient);

	setupTerminalIPC(daemonClient);

	// Initialize database early — tRPC handlers depend on it
	try {
		initializeDatabase();
		await backfillRemoteHosts();
		ensureTelemetryState(getDb());
		recoverStuckSessions();
	} catch (err) {
		log.error("[db] Failed to initialize database:", err);
		dialog.showErrorBox(
			"Database Error",
			`SuperiorSwarm failed to initialize its database and cannot start.\n\n${String(err)}`
		);
		app.quit();
		return;
	}

	const debugRow = getDb()
		.select()
		.from(schema.sessionState)
		.where(eq(schema.sessionState.key, "debug_mode"))
		.get();
	const debugEnabled = debugRow?.value === "1";
	setDebugMode(debugEnabled);
	log.info(`[debug-mode] ${debugEnabled ? "ENABLED" : "disabled"}`);

	// Warm the login-shell PATH cache so the first LSP IPC doesn't block on
	// `<shell> -ilc` execSync. Fire-and-forget — populates a module-level cache.
	warmShellPathCache();

	// Set up tRPC IPC so the renderer can make queries once it loads
	setupTRPCIPC(appRouter);

	void (async () => {
		try {
			const { syncIfDue } = await import("./telemetry/sync");
			await syncIfDue();
		} catch (err) {
			log.debug("[telemetry] launch sync skipped:", err);
		}
	})();

	// Register IPC handlers needed by the renderer
	ipcMain.on("terminal-sessions:save-sync", (event, data: SessionSaveData) => {
		try {
			saveTerminalSessions(data);
			if (data.paneLayouts) {
				savePaneLayouts(data.paneLayouts);
			}
			event.returnValue = { ok: true };
		} catch (err) {
			log.error("Failed to save terminal sessions on quit:", err);
			event.returnValue = { ok: false };
		}
	});

	ipcMain.handle("shell:openExternal", async (_event, url: string) => {
		if (typeof url === "string" && isHttpUrl(url)) {
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

	// Show the window NOW — branded splash screen in index.html is visible immediately
	createWindow();

	if (mainWindow) {
		setupLspIPC(mainWindow);
	}

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});

	// --- Everything below runs AFTER the window is visible ---

	// Register agent hooks (must complete before listener starts)
	await setupAgentHooks();

	// Agent notification listener
	// Dev mode uses OS-assigned port to avoid stealing the prod listener's port.
	// Prod mode reclaims the well-known port from stale instances before binding.
	const listenerPort = import.meta.env.DEV ? 0 : AGENT_NOTIFY_PORT;
	if (!import.meta.env.DEV) {
		await reclaimPort(AGENT_NOTIFY_PORT);
	}
	alertListener = createAlertListener(listenerPort);
	try {
		await alertListener.start();
		const port = alertListener.getPort();
		if (port) {
			setAgentNotifyPort(port);
			// Update the OpenCode plugin with the actual bound port
			// (may differ from AGENT_NOTIFY_PORT if fallback was used)
			if (port !== AGENT_NOTIFY_PORT) {
				updateOpenCodePluginPort(port);
			}
		}
		alertListener.onEvent((event) => {
			broadcastToWindows("agent:alert", event);
		});
	} catch (err) {
		log.error("[agent-notify] failed to start listener:", err);
		alertListener = null;
	}

	// Clean up zombie daemons from previous dev sessions
	cleanupStaleDaemons(daemonInstanceId(__dirname));

	// ── Register provider adapters ────────────────────────────────────────────
	registerGitProvider(new GitHubAdapter());
	registerGitProvider(new BitbucketAdapter());
	registerIssueTracker(new JiraAdapter());
	registerIssueTracker(new LinearAdapter());

	// Background tasks — none of these block the UI
	cleanupStaleReviews();
	startPolling();
	startPRPolling();
	startCommentPoller();

	onNewPRDetected((pr) => {
		void maybeAutoTriggerReview({ pr }).catch((err) => {
			log.error("[ai-review] Auto-trigger failed:", err);
		});
	});

	onPRCommitChanged((pr, _previousSha) => {
		void maybeAutoReReview({ pr }).catch((err) =>
			log.error("[auto-review] Re-review on commit change failed:", err)
		);
	});

	onPRClosedDetected(async (pr) => {
		try {
			const wsId = findReviewWorkspaceByPR(pr.provider, pr.identifier);
			if (wsId) {
				await cleanupReviewWorkspace(wsId);
			}
		} catch (err) {
			log.error("[main] Error handling PR closed event:", err);
		}
	});

	// Clear ephemeral terminal IDs (reset across sessions)
	{
		const db = getDb();
		db.update(schema.workspaces).set({ terminalId: null, updatedAt: new Date() }).run();
	}

	const dbPath = join(app.getPath("userData"), "superiorswarm.db");
	const daemonScriptPath = join(app.getAppPath(), "out", "main", "daemon.js");
	try {
		await daemonClient.connect(dbPath, daemonScriptPath);
	} catch (err) {
		const { isDaemonOwnershipMismatchError } = await import("./terminal/daemon-ownership");
		if (isDaemonOwnershipMismatchError(err)) {
			log.error("[main] Daemon owned by another app instance, not retrying:", err);
		} else {
			log.error("[main] Failed to connect to terminal daemon, will retry:", err);
			daemonClient.startReconnecting();
		}
	}

	initializeUpdater().catch((err) => {
		log.error("[main] Failed to initialize updater:", err);
	});
});

app.on("before-quit", () => {
	alertListener?.stop();
	setAgentNotifyPort(null);
	stopCommentPoller();
	teardownUpdater();
	daemonClient.setQuitting();
	daemonClient.detachAll();
	daemonClient.disconnect();
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
		alertListener?.stop();
		setAgentNotifyPort(null);
		teardownUpdater();
		daemonClient.setQuitting();
		daemonClient.detachAll();
		daemonClient.disconnect();
		serverManager.disposeAll();
		app.exit(0);
	});
}
