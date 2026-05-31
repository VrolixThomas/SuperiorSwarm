import { BrowserWindow, ipcMain } from "electron";
import type { RepoInvalidateEvent } from "../shared/types";
import { bumpRepoStateVersion } from "./git/repo-state-version";
import { RepoWatcherManager } from "./git/repo-watcher-manager";
import { log } from "./logger";
import { withTimeout } from "./util/with-timeout";

interface SubscriptionEntry {
	count: number;
	off: () => Promise<void>;
}

let manager: RepoWatcherManager | null = null;
const subscriptionsByWindow = new WeakMap<BrowserWindow, Map<string, SubscriptionEntry>>();

export function setupRepoIPC(getMainWindow: () => BrowserWindow | null): void {
	manager = new RepoWatcherManager();

	ipcMain.handle("repo:subscribe", async (event, repoPath: unknown) => {
		if (typeof repoPath !== "string" || repoPath.length === 0) return;
		if (!manager) return;
		const window = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
		if (!window) return;

		let perWindow = subscriptionsByWindow.get(window);
		if (!perWindow) {
			perWindow = new Map();
			subscriptionsByWindow.set(window, perWindow);
			window.on("closed", () => {
				const subs = subscriptionsByWindow.get(window);
				if (!subs) return;
				for (const entry of subs.values()) void entry.off();
				subscriptionsByWindow.delete(window);
			});
		}

		const existing = perWindow.get(repoPath);
		if (existing) {
			existing.count += 1;
			return;
		}

		try {
			const off = await manager.subscribe(repoPath, (e) => {
				bumpRepoStateVersion(repoPath);
				if (window.isDestroyed()) return;
				const payload: RepoInvalidateEvent = { repoPath, kinds: e.kinds };
				window.webContents.send("repo:invalidate", payload);
			});
			perWindow.set(repoPath, { count: 1, off });
		} catch (err) {
			log.error("[repo-ipc] subscribe failed", repoPath, err);
		}
	});

	ipcMain.handle("repo:unsubscribe", async (event, repoPath: unknown) => {
		if (typeof repoPath !== "string") return;
		const window = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
		if (!window) return;
		const perWindow = subscriptionsByWindow.get(window);
		const entry = perWindow?.get(repoPath);
		if (!entry) return;
		entry.count -= 1;
		if (entry.count <= 0) {
			await entry.off();
			perWindow?.delete(repoPath);
		}
	});
}

export async function disposeRepoIPC(): Promise<void> {
	if (!manager) return;
	await manager.disposeAll();
	manager = null;
}

/**
 * Best-effort watcher teardown bounded to `ms`. Returns true if disposal
 * completed, false if it timed out (caller proceeds to exit regardless).
 */
export async function disposeRepoIPCWithTimeout(ms: number): Promise<boolean> {
	return withTimeout(
		disposeRepoIPC().then(() => true),
		ms,
		false
	);
}
