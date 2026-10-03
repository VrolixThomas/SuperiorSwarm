import { BrowserWindow, ipcMain } from "electron";
import type { RepoInvalidateEvent } from "../shared/types";
import { bumpRepoStateVersion } from "./git/repo-state-version";
import { disposeRepoWatcherManager, getRepoWatcherManager } from "./git/repo-watcher-instance";
import { log } from "./logger";
import { withTimeout } from "./util/with-timeout";

interface SubscriptionEntry {
	count: number;
	off: () => Promise<void>;
}

const subscriptionsByWindow = new WeakMap<BrowserWindow, Map<string, SubscriptionEntry>>();

export function setupRepoIPC(getMainWindow: () => BrowserWindow | null): void {
	const manager = getRepoWatcherManager();

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
				for (const entry of subs.values()) void entry.off();
				subscriptionsByWindow.delete(window);
			});
		}

		const existing = perWindow.get(repoPath);
		if (existing) {
			existing.count += 1;
			return;
		}

		// Publish the entry before awaiting startup: Files and its host can subscribe together.
		const starting = manager.subscribe(repoPath, (e) => {
			bumpRepoStateVersion(repoPath);
			if (window.isDestroyed()) return;
			const payload: RepoInvalidateEvent = { repoPath, kinds: e.kinds };
			window.webContents.send("repo:invalidate", payload);
		});
		let stopped = false;
		const entry: SubscriptionEntry = {
			count: 1,
			off: async () => {
				if (stopped) return;
				stopped = true;
				const off = await starting.catch(() => null);
				await off?.();
			},
		};
		perWindow.set(repoPath, entry);
		try {
			await starting;
		} catch (err) {
			if (perWindow.get(repoPath) === entry) perWindow.delete(repoPath);
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
			perWindow?.delete(repoPath);
			await entry.off();
		}
	});
}

export async function disposeRepoIPC(): Promise<void> {
	await disposeRepoWatcherManager();
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
