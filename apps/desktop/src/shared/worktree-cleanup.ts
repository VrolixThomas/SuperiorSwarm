export const ACTIVE_WORKTREE_CLEANUP_STATUSES = [
	"pending",
	"queued",
	"running",
	"retry_wait",
] as const;
export const BLOCKING_WORKTREE_CLEANUP_STATUSES = [
	...ACTIVE_WORKTREE_CLEANUP_STATUSES,
	"failed",
] as const;

export type WorktreeCleanupStatus =
	| (typeof ACTIVE_WORKTREE_CLEANUP_STATUSES)[number]
	| "completed"
	| "failed";

export interface WorktreePathIdentity {
	device: string;
	inode: string;
	birthtimeNs: string;
}

export function encodeWorktreePathIdentity(identity: WorktreePathIdentity): string {
	return JSON.stringify(identity);
}

export function decodeWorktreePathIdentity(value: string): WorktreePathIdentity {
	const parsed = JSON.parse(value) as Partial<WorktreePathIdentity>;
	if (
		typeof parsed.device !== "string" ||
		typeof parsed.inode !== "string" ||
		typeof parsed.birthtimeNs !== "string"
	) {
		throw new Error("Invalid persisted worktree path identity");
	}
	return {
		device: parsed.device,
		inode: parsed.inode,
		birthtimeNs: parsed.birthtimeNs,
	};
}

export type WorktreeCleanupPhase =
	| "preparing"
	| "renamed"
	| "git_pruned"
	| "deleting_files"
	| "verifying";

export const CLEANUP_LEASE_MS = 30_000;
export const CLEANUP_HEARTBEAT_MS = 5_000;
export const CLEANUP_MAX_ATTEMPTS = 8;
export const CLEANUP_GIT_TIMEOUT_MS = 15_000;
export const CLEANUP_GIT_TERMINATE_GRACE_MS = 1_000;
// A single attempt is bounded so a stuck mount cannot monopolize the serialized
// worker. Large cleanups can continue making partial progress across retries.
export const CLEANUP_DELETE_TIMEOUT_MS = 5 * 60_000;
export const CLEANUP_DELETE_TERMINATE_GRACE_MS = 2_000;
