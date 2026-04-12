import type { App, BrowserWindow } from "electron";

export function registerSingleInstance(
	app: App,
	getMainWindow: () => BrowserWindow | null
): boolean {
	const gotLock = app.requestSingleInstanceLock();
	if (!gotLock) {
		app.quit();
		return false;
	}

	app.on("second-instance", () => {
		handleSecondInstance(getMainWindow());
	});

	return true;
}

export function handleSecondInstance(win: BrowserWindow | null): boolean {
	if (!win) return false;
	if (win.isDestroyed()) return false;
	if (win.isMinimized()) win.restore();
	win.focus();
	return true;
}
