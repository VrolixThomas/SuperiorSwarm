import { resolve } from "node:path";
import { RepoWatcher, type RepoWatcherListener } from "./repo-watcher";

interface Entry {
	watcher: RepoWatcher;
}

export class RepoWatcherManager {
	private entries = new Map<string, Entry>();
	private listeners = new Map<string, Set<RepoWatcherListener>>();
	private starting = new Map<string, Promise<Entry | null>>();
	private suspended = new Map<string, string>();
	private disposed = false;

	async subscribe(repoPath: string, listener: RepoWatcherListener): Promise<() => Promise<void>> {
		const key = resolve(repoPath);
		if (this.disposed) return async () => {};

		let listeners = this.listeners.get(key);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(key, listeners);
		}
		listeners.add(listener);
		try {
			if (!this.suspended.has(key)) await this.ensureWatcher(key);
		} catch (error) {
			listeners.delete(listener);
			if (listeners.size === 0) this.listeners.delete(key);
			throw error;
		}

		let subscribed = true;
		return async () => {
			if (!subscribed) return;
			subscribed = false;
			const currentListeners = this.listeners.get(key);
			if (!currentListeners) return;
			currentListeners.delete(listener);
			if (currentListeners.size > 0) return;
			this.listeners.delete(key);
			const entry = this.entries.get(key);
			if (!entry) return;
			this.entries.delete(key);
			await entry.watcher.close();
		};
	}

	private async ensureWatcher(key: string): Promise<Entry | null> {
		if (this.disposed || this.suspended.has(key) || !this.listeners.has(key)) return null;
		const entry = this.entries.get(key);
		if (entry) return entry;
		let start = this.starting.get(key);
		if (!start) {
			start = this.startWatcher(key);
			this.starting.set(key, start);
		}
		return start;
	}

	private async startWatcher(key: string): Promise<Entry | null> {
		const watcher = new RepoWatcher(key);
		const entry: Entry = { watcher };
		try {
			await watcher.start();
			if (this.disposed || this.suspended.has(key) || !this.listeners.has(key)) {
				await watcher.close();
				return null;
			}
			this.entries.set(key, entry);
			watcher.on((event) => {
				if (this.suspended.has(key)) return;
				for (const listener of this.listeners.get(key) ?? []) listener(event);
			});
			return entry;
		} finally {
			this.starting.delete(key);
		}
	}

	async suspend(repoPath: string, reason: string): Promise<void> {
		const key = resolve(repoPath);
		this.suspended.set(key, reason);
		const start = this.starting.get(key);
		if (start) await start.catch(() => null);
		const entry = this.entries.get(key);
		if (!entry) return;
		this.entries.delete(key);
		await entry.watcher.close();
	}

	async resume(repoPath: string): Promise<void> {
		const key = resolve(repoPath);
		this.suspended.delete(key);
		await this.ensureWatcher(key);
	}

	isSuspended(repoPath: string): boolean {
		return this.suspended.has(resolve(repoPath));
	}

	activeCount(repoPath: string): number {
		return this.listeners.get(resolve(repoPath))?.size ?? 0;
	}

	isWatching(repoPath: string): boolean {
		return this.entries.has(resolve(repoPath));
	}

	async disposeAll(): Promise<void> {
		this.disposed = true;
		await Promise.allSettled(this.starting.values());
		const entries = Array.from(this.entries.values());
		this.entries.clear();
		this.listeners.clear();
		this.suspended.clear();
		await Promise.all(entries.map((e) => e.watcher.close()));
	}
}
