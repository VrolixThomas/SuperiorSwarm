import { RepoWatcherManager } from "./repo-watcher-manager";

let instance: RepoWatcherManager | null = null;

export function getRepoWatcherManager(): RepoWatcherManager {
	instance ??= new RepoWatcherManager();
	return instance;
}

export async function suspendRepoWatching(repoPath: string, reason: string): Promise<void> {
	await getRepoWatcherManager().suspend(repoPath, reason);
}

export async function resumeRepoWatching(repoPath: string): Promise<void> {
	await getRepoWatcherManager().resume(repoPath);
}

export async function disposeRepoWatcherManager(): Promise<void> {
	const manager = instance;
	instance = null;
	await manager?.disposeAll();
}
