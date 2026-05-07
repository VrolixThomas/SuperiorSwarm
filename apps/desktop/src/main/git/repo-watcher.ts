import { join } from "node:path";
import { type FSWatcher, watch } from "chokidar";
import type { RepoChangeKind } from "../../shared/types";
import { log } from "../logger";
import { resolveGitDir } from "./operations";

export interface RepoWatcherEvent {
	kinds: RepoChangeKind[];
}

export type RepoWatcherListener = (event: RepoWatcherEvent) => void;

const DEBOUNCE_MS = 200;

export class RepoWatcher {
	private gitDirWatcher: FSWatcher | null = null;
	private worktreeWatcher: FSWatcher | null = null;
	private listeners = new Set<RepoWatcherListener>();
	private pending = new Set<RepoChangeKind>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly repoPath: string) {}

	on(listener: RepoWatcherListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async start(): Promise<void> {
		const gitDir = await resolveGitDir(this.repoPath);

		this.gitDirWatcher = watch(
			[
				join(gitDir, "HEAD"),
				join(gitDir, "index"),
				join(gitDir, "MERGE_HEAD"),
				join(gitDir, "CHERRY_PICK_HEAD"),
				join(gitDir, "REBASE_HEAD"),
				join(gitDir, "rebase-apply"),
				join(gitDir, "rebase-merge"),
				join(gitDir, "packed-refs"),
				join(gitDir, "refs"),
			],
			{ ignoreInitial: true, persistent: true, depth: 8 }
		);

		this.gitDirWatcher.on("all", (_event, path) => this.classifyGitDirEvent(path));
		this.gitDirWatcher.on("error", (err) => log.error("[RepoWatcher] gitDir watcher error", err));

		this.worktreeWatcher = watch(this.repoPath, {
			ignoreInitial: true,
			persistent: true,
			ignored: [
				/(^|[\\/])\.git([\\/]|$)/,
				/(^|[\\/])node_modules([\\/]|$)/,
				/(^|[\\/])dist([\\/]|$)/,
				/(^|[\\/])out([\\/]|$)/,
				/(^|[\\/])build([\\/]|$)/,
				/(^|[\\/])\.next([\\/]|$)/,
				/(^|[\\/])\.turbo([\\/]|$)/,
				/(^|[\\/])target([\\/]|$)/,
				/(^|[\\/])coverage([\\/]|$)/,
				/(^|[\\/])graphify-out([\\/]|$)/,
			],
		});

		this.worktreeWatcher.on("all", () => this.queue("working-tree"));
		this.worktreeWatcher.on("error", (err) =>
			log.error("[RepoWatcher] worktree watcher error", err)
		);

		await Promise.all([waitReady(this.gitDirWatcher), waitReady(this.worktreeWatcher)]);
	}

	async close(): Promise<void> {
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = null;
		this.pending.clear();
		this.listeners.clear();
		await Promise.all([this.gitDirWatcher?.close(), this.worktreeWatcher?.close()]);
		this.gitDirWatcher = null;
		this.worktreeWatcher = null;
	}

	private classifyGitDirEvent(rawPath: string): void {
		const path = rawPath.replace(/\\/g, "/");
		if (path.endsWith("/HEAD")) {
			this.queue("head");
			return;
		}
		if (path.endsWith("/index")) {
			this.queue("index");
			return;
		}
		if (
			path.includes("/MERGE_HEAD") ||
			path.includes("/CHERRY_PICK_HEAD") ||
			path.includes("/REBASE_HEAD") ||
			path.includes("/rebase-apply") ||
			path.includes("/rebase-merge")
		) {
			this.queue("state");
			return;
		}
		if (path.includes("/refs/") || path.endsWith("/packed-refs")) {
			this.queue("refs");
			return;
		}
	}

	private queue(kind: RepoChangeKind): void {
		this.pending.add(kind);
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => this.flush(), DEBOUNCE_MS);
	}

	private flush(): void {
		this.flushTimer = null;
		if (this.pending.size === 0) return;
		const kinds = Array.from(this.pending);
		this.pending.clear();
		const event: RepoWatcherEvent = { kinds };
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				log.error("[RepoWatcher] listener threw", err);
			}
		}
	}
}

function waitReady(w: FSWatcher): Promise<void> {
	return new Promise((resolve, reject) => {
		const onReady = () => {
			w.off("error", onError);
			resolve();
		};
		const onError = (err: unknown) => {
			w.off("ready", onReady);
			reject(err instanceof Error ? err : new Error(String(err)));
		};
		w.once("ready", onReady);
		w.once("error", onError);
	});
}
