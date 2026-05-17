import { forceRemoveWorktree as defaultForceRemove } from "../git/operations";

export interface WorktreeCleanupQueueDeps {
	forceRemove?: (repoPath: string, worktreePath: string) => Promise<void>;
}

export interface WorktreeCleanupQueue {
	schedule(repoPath: string, worktreePath: string): void;
	pendingCount(): number;
	drain(): Promise<void>;
}

interface QueueItem {
	repoPath: string;
	worktreePath: string;
}

export function createWorktreeCleanupQueue(
	deps: WorktreeCleanupQueueDeps = {}
): WorktreeCleanupQueue {
	const forceRemove = deps.forceRemove ?? defaultForceRemove;
	const items: QueueItem[] = [];
	let running: Promise<void> | null = null;
	let activeCount = 0;

	async function run(): Promise<void> {
		for (;;) {
			const next = items.shift();
			if (!next) break;
			activeCount++;
			try {
				await forceRemove(next.repoPath, next.worktreePath);
			} catch (err) {
				console.error(`[worktree-cleanup-queue] failed for ${next.worktreePath}:`, err);
			} finally {
				activeCount--;
			}
		}
		running = null;
	}

	return {
		schedule(repoPath, worktreePath) {
			items.push({ repoPath, worktreePath });
			if (!running) {
				running = Promise.resolve().then(run);
			}
		},
		pendingCount() {
			return items.length + activeCount;
		},
		async drain() {
			if (running) {
				await running;
			}
		},
	};
}

let singleton: WorktreeCleanupQueue | null = null;

export function getWorktreeCleanupQueue(): WorktreeCleanupQueue {
	if (!singleton) {
		singleton = createWorktreeCleanupQueue();
	}
	return singleton;
}

/** Test-only — reset the singleton between tests. */
export function _resetWorktreeCleanupQueueForTesting(): void {
	singleton = null;
}
