import { app } from "electron";
import log from "electron-log/main.js";

log.initialize();

log.transports.file.level = "info";
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";

log.transports.console.level = app.isPackaged ? false : "debug";

// JavaScript exceptions only — V8 C++ traps cannot be caught from JS. The
// ipc-safety walker is the mitigation for that case.
log.errorHandler.startCatching({
	showDialog: false,
});

// `app` must be ready before these signals are observable; call from whenReady.
export function setupCrashHandlers(): void {
	app.on("render-process-gone", (_event, _webContents, details) => {
		log.error("render-process-gone", details);
	});
	app.on("child-process-gone", (_event, details) => {
		log.error("child-process-gone", details);
	});
}

export { log };
