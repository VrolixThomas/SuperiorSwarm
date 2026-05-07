import { BrowserWindow, ipcMain } from "electron";
import type { RepoInvalidateEvent } from "../shared/types";
import { RepoWatcherManager } from "./git/repo-watcher-manager";
import { log } from "./logger";

let manager: RepoWatcherManager | null = null;
const subscriptionsByWindow = new WeakMap<BrowserWindow, Map<string, () => Promise<void>>>();

export function setupRepoIPC(getMainWindow: () => BrowserWindow | null): void {
	manager = new RepoWatcherManager();

	ipcMain.handle("repo:subscribe", async (event, repoPath: unknown) => {
		if (typeof repoPath !== "string" || repoPath.length === 0) return;
		const window = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
		if (!window) return;

		let perWindow = subscriptionsByWindow.get(window);
		if (!perWindow) {
			perWindow = new Map();
			subscriptionsByWindow.set(window, perWindow);
			window.on("closed", () => {
				const subs = subscriptionsByWindow.get(window);
				if (!subs) return;
				for (const off of subs.values()) void off();
				subscriptionsByWindow.delete(window);
			});
		}
		if (perWindow.has(repoPath)) return;

		try {
			const unsubscribe = await manager!.subscribe(repoPath, (e) => {
				if (window.isDestroyed()) return;
				const payload: RepoInvalidateEvent = { repoPath, kinds: e.kinds };
				window.webContents.send("repo:invalidate", payload);
			});
			perWindow.set(repoPath, unsubscribe);
		} catch (err) {
			log.error("[repo-ipc] subscribe failed", repoPath, err);
		}
	});

	ipcMain.handle("repo:unsubscribe", async (event, repoPath: unknown) => {
		if (typeof repoPath !== "string") return;
		const window = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
		if (!window) return;
		const perWindow = subscriptionsByWindow.get(window);
		const off = perWindow?.get(repoPath);
		if (off) {
			await off();
			perWindow?.delete(repoPath);
		}
	});
}

export async function disposeRepoIPC(): Promise<void> {
	if (!manager) return;
	await manager.disposeAll();
	manager = null;
}
