import { RepoWatcher, type RepoWatcherListener } from "./repo-watcher";

interface Entry {
	watcher: RepoWatcher;
	listeners: Set<RepoWatcherListener>;
}

export class RepoWatcherManager {
	private entries = new Map<string, Entry>();

	async subscribe(repoPath: string, listener: RepoWatcherListener): Promise<() => Promise<void>> {
		let entry = this.entries.get(repoPath);
		if (!entry) {
			const watcher = new RepoWatcher(repoPath);
			await watcher.start();
			entry = { watcher, listeners: new Set() };
			this.entries.set(repoPath, entry);
			watcher.on((event) => {
				for (const l of entry?.listeners ?? []) l(event);
			});
		}
		entry.listeners.add(listener);

		return async () => {
			const e = this.entries.get(repoPath);
			if (!e) return;
			e.listeners.delete(listener);
			if (e.listeners.size === 0) {
				this.entries.delete(repoPath);
				await e.watcher.close();
			}
		};
	}

	activeCount(repoPath: string): number {
		return this.entries.get(repoPath)?.listeners.size ?? 0;
	}

	isWatching(repoPath: string): boolean {
		return this.entries.has(repoPath);
	}

	async disposeAll(): Promise<void> {
		const entries = Array.from(this.entries.values());
		this.entries.clear();
		await Promise.all(entries.map((e) => e.watcher.close()));
	}
}
