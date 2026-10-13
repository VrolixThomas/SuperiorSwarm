import type { BrowserWindow } from "electron";

let mainWindow: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow | null): void {
	mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
	return mainWindow;
}

/** Native install errors can arrive after Electron has closed the windows. */
export function recoverMainWindow(createWindow: () => void): void {
	if (!mainWindow || mainWindow.isDestroyed()) {
		createWindow();
		return;
	}
	mainWindow.show();
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
}
