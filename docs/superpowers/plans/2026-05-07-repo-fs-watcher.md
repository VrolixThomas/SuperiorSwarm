# Repo FS Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2-second polling loop that drives `getWorkingTreeStatus`, `getBranchDiff`, `getCommitsAhead`, and `branches.getStatus` with FS-watcher-driven invalidation, eliminating the per-tick git-spawn cost that lags the UI and terminal in big repos (e.g. Portal).

**Architecture:**
1. **Per-repo `RepoWatcher`** in main process (chokidar) watches `.git/` metadata + working tree, emits coalesced typed events (`working-tree`, `index`, `head`, `refs`, `state`).
2. **Watcher registry** (`RepoWatcherManager`) ref-counts watchers per repo path; renderer subscribes/unsubscribes via IPC.
3. **Main process broadcasts** `repo:invalidate` events to the single main window over `webContents.send`. Renderer wires those into `useRepoSubscription(repoPath)` which calls `utils.<router>.<proc>.invalidate()` on the right keys.
4. **Cache layer** in `getBranchDiff/getWorkingTreeStatus/getCommitsAhead/getBranchStatus` keyed by a per-repo state-version (bumped by the watcher) — cheap memoization across renderer focus/refetch storms.
5. **Component rewiring**: drop `refetchInterval: 2_000` from DiffPanel/BranchChanges/CommittedStack/BranchChip/ReviewTab. Replace with watcher-driven invalidation + a 30 s heartbeat fallback (in case watcher misses an event on a network FS).
6. **Drop `-uall`** from `getUntrackedFiles`; reserve it for the file-tree expand path that actually needs it.

**Tech Stack:** Electron, TypeScript, Bun (test runner), tRPC over Electron IPC, simple-git, react-query, chokidar (new dep), Biome.

---

## Affected Files

- **Create:**
  - `apps/desktop/src/main/git/repo-watcher.ts` — `RepoWatcher` class (chokidar wrapper, debouncer, event emitter)
  - `apps/desktop/src/main/git/repo-watcher-manager.ts` — `RepoWatcherManager` (ref-counted registry)
  - `apps/desktop/src/main/git/repo-state-version.ts` — per-repo state-version counter (bumped by watcher, read by cache)
  - `apps/desktop/src/main/git/git-cache.ts` — generic memoize-by-version helper
  - `apps/desktop/src/main/repo-ipc.ts` — `setupRepoIPC()` + `broadcastRepoInvalidate()`
  - `apps/desktop/src/renderer/hooks/useRepoSubscription.ts` — subscribe + dispatch invalidations
  - `apps/desktop/tests/repo-watcher.test.ts`
  - `apps/desktop/tests/repo-watcher-manager.test.ts`
  - `apps/desktop/tests/git-cache.test.ts`
  - `apps/desktop/tests/get-branch-diff-cache.test.ts`

- **Modify:**
  - `apps/desktop/package.json` — add `chokidar`
  - `apps/desktop/src/shared/types.ts` — add `RepoAPI` to `electron.repo` bridge typing
  - `apps/desktop/src/preload/index.ts` — expose `repo.subscribe/unsubscribe/onInvalidate`
  - `apps/desktop/src/main/index.ts` — call `setupRepoIPC(mainWindow)` after the window is created; dispose manager on `before-quit`
  - `apps/desktop/src/main/trpc/routers/diff.ts` — wrap `getBranchDiff`, `getWorkingTreeDiff`, `getWorkingTreeStatus`, `getCommitsAhead` with the cache
  - `apps/desktop/src/main/trpc/routers/branches.ts` — wrap `getStatus` with the cache
  - `apps/desktop/src/main/git/operations.ts` — `getUntrackedFiles`: switch from `-uall` to `-unormal` for the polling caller; add a separate `getUntrackedFilesDeep()` for the file-tree expand case
  - `apps/desktop/src/renderer/components/DiffPanel.tsx` — drop `refetchInterval`, mount `useRepoSubscription`
  - `apps/desktop/src/renderer/components/BranchChanges.tsx` — drop `refetchInterval`, mount `useRepoSubscription`
  - `apps/desktop/src/renderer/components/CommittedStack.tsx` — drop `refetchInterval`, mount `useRepoSubscription`
  - `apps/desktop/src/renderer/components/BranchChip.tsx` — drop `refetchInterval`, mount `useRepoSubscription`
  - `apps/desktop/src/renderer/components/review/ReviewTab.tsx` — drop both `refetchInterval`, mount `useRepoSubscription`
  - `apps/desktop/src/renderer/App.tsx:444` — drop `refetchInterval` on `branches.getStatus`

---

## Task 1: Add chokidar dependency

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Install chokidar**

```bash
cd apps/desktop && bun add chokidar@^4
```

- [ ] **Step 2: Verify install**

```bash
cd apps/desktop && grep '"chokidar"' package.json
```

Expected: a `"chokidar": "^4.x.x"` line under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json apps/desktop/bun.lock
git commit -m "deps: add chokidar for repo FS watcher"
```

---

## Task 2: Define RepoWatcher event types in shared/

**Files:**
- Modify: `apps/desktop/src/shared/types.ts`

- [ ] **Step 1: Add types at the bottom of `types.ts`**

```ts
export type RepoChangeKind =
	| "working-tree"
	| "index"
	| "head"
	| "refs"
	| "state";

export interface RepoInvalidateEvent {
	repoPath: string;
	kinds: RepoChangeKind[];
}

export interface RepoAPI {
	subscribe: (repoPath: string) => Promise<void>;
	unsubscribe: (repoPath: string) => Promise<void>;
	onInvalidate: (callback: (event: RepoInvalidateEvent) => void) => () => void;
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/desktop && bun run type-check
```

Expected: no errors in `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/shared/types.ts
git commit -m "feat(repo-watcher): add shared types for repo invalidation"
```

---

## Task 3: Failing test for RepoWatcher — emits `index` on `git add`

**Files:**
- Create: `apps/desktop/tests/repo-watcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { RepoWatcher } from "../src/main/git/repo-watcher";
import { initRepo } from "../src/main/git/operations";
import type { RepoChangeKind } from "../src/shared/types";

const TEST_ROOT = realpathSync(tmpdir());

let repoPath: string;
let watcher: RepoWatcher;

beforeEach(async () => {
	repoPath = join(TEST_ROOT, `repo-watcher-${Date.now()}-${Math.random()}`);
	mkdirSync(repoPath, { recursive: true });
	await initRepo(repoPath, "main");
	await simpleGit(repoPath).raw(["commit", "--allow-empty", "-m", "init"]);
});

afterEach(async () => {
	await watcher?.close();
	rmSync(repoPath, { recursive: true, force: true });
});

async function waitForKind(kind: RepoChangeKind, timeoutMs = 2000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`timeout waiting for ${kind}`)), timeoutMs);
		const off = watcher.on((event) => {
			if (event.kinds.includes(kind)) {
				clearTimeout(timer);
				off();
				resolve();
			}
		});
	});
}

describe("RepoWatcher", () => {
	test("emits 'index' kind when files are staged", async () => {
		watcher = new RepoWatcher(repoPath);
		await watcher.start();

		writeFileSync(join(repoPath, "a.txt"), "hello");
		await simpleGit(repoPath).add(["a.txt"]);

		await waitForKind("index");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && bun test tests/repo-watcher.test.ts
```

Expected: FAIL — `RepoWatcher` not found / cannot import from `../src/main/git/repo-watcher`.

- [ ] **Step 3: Commit failing test**

```bash
git add apps/desktop/tests/repo-watcher.test.ts
git commit -m "test(repo-watcher): failing test for index events"
```

---

## Task 4: Implement minimal RepoWatcher to pass the index test

**Files:**
- Create: `apps/desktop/src/main/git/repo-watcher.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
import { watch, type FSWatcher } from "chokidar";
import { join } from "node:path";
import type { RepoChangeKind } from "../../shared/types";

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
		const gitDir = join(this.repoPath, ".git");

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

		this.worktreeWatcher = watch(this.repoPath, {
			ignoreInitial: true,
			persistent: true,
			ignored: [/(^|[\\/])\.git([\\/]|$)/, /node_modules/],
		});

		this.worktreeWatcher.on("all", () => this.queue("working-tree"));

		await Promise.all([
			waitReady(this.gitDirWatcher),
			waitReady(this.worktreeWatcher),
		]);
	}

	async close(): Promise<void> {
		if (this.flushTimer) clearTimeout(this.flushTimer);
		this.flushTimer = null;
		this.pending.clear();
		this.listeners.clear();
		await Promise.all([
			this.gitDirWatcher?.close(),
			this.worktreeWatcher?.close(),
		]);
		this.gitDirWatcher = null;
		this.worktreeWatcher = null;
	}

	private classifyGitDirEvent(path: string): void {
		if (path.endsWith("/HEAD") || path.endsWith("\\HEAD")) {
			this.queue("head");
			return;
		}
		if (path.endsWith("/index") || path.endsWith("\\index")) {
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
		for (const listener of this.listeners) listener(event);
	}
}

function waitReady(w: FSWatcher): Promise<void> {
	return new Promise((resolve) => w.once("ready", () => resolve()));
}
```

- [ ] **Step 2: Run test to verify it passes**

```bash
cd apps/desktop && bun test tests/repo-watcher.test.ts
```

Expected: PASS for "emits 'index' kind when files are staged".

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/git/repo-watcher.ts
git commit -m "feat(repo-watcher): implement chokidar-backed RepoWatcher"
```

---

## Task 5: Add tests for the remaining event kinds

**Files:**
- Modify: `apps/desktop/tests/repo-watcher.test.ts`

- [ ] **Step 1: Append tests**

```ts
test("emits 'working-tree' kind when a tracked file changes", async () => {
	writeFileSync(join(repoPath, "tracked.txt"), "v1");
	await simpleGit(repoPath).add(["tracked.txt"]);
	await simpleGit(repoPath).commit("add tracked");

	watcher = new RepoWatcher(repoPath);
	await watcher.start();

	writeFileSync(join(repoPath, "tracked.txt"), "v2");
	await waitForKind("working-tree");
});

test("emits 'head' kind on branch checkout", async () => {
	const git = simpleGit(repoPath);
	await git.checkoutLocalBranch("feature/x");
	await git.checkout("main");

	watcher = new RepoWatcher(repoPath);
	await watcher.start();

	await git.checkout("feature/x");
	await waitForKind("head");
});

test("emits 'refs' kind on commit", async () => {
	watcher = new RepoWatcher(repoPath);
	await watcher.start();

	writeFileSync(join(repoPath, "b.txt"), "b");
	await simpleGit(repoPath).add(["b.txt"]);
	await simpleGit(repoPath).commit("b");
	await waitForKind("refs");
});

test("debounces rapid changes into one event", async () => {
	watcher = new RepoWatcher(repoPath);
	await watcher.start();

	const events: RepoChangeKind[][] = [];
	watcher.on((e) => events.push(e.kinds));

	for (let i = 0; i < 5; i++) {
		writeFileSync(join(repoPath, `f${i}.txt`), String(i));
	}

	await new Promise((r) => setTimeout(r, 600));
	expect(events.length).toBeLessThanOrEqual(2);
	expect(events.flat()).toContain("working-tree");
});
```

- [ ] **Step 2: Run all watcher tests**

```bash
cd apps/desktop && bun test tests/repo-watcher.test.ts
```

Expected: PASS for all 4 cases. If any FAIL, fix `repo-watcher.ts` (likely tweak `classifyGitDirEvent` path matching or `ignored` patterns) and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/tests/repo-watcher.test.ts apps/desktop/src/main/git/repo-watcher.ts
git commit -m "test(repo-watcher): cover working-tree, head, refs, debounce"
```

---

## Task 6: Failing test for RepoWatcherManager — ref-counting

**Files:**
- Create: `apps/desktop/tests/repo-watcher-manager.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { RepoWatcherManager } from "../src/main/git/repo-watcher-manager";
import { initRepo } from "../src/main/git/operations";

const TEST_ROOT = realpathSync(tmpdir());

let repoPath: string;
let manager: RepoWatcherManager;

beforeEach(async () => {
	repoPath = join(TEST_ROOT, `rwm-${Date.now()}-${Math.random()}`);
	mkdirSync(repoPath, { recursive: true });
	await initRepo(repoPath, "main");
	await simpleGit(repoPath).raw(["commit", "--allow-empty", "-m", "init"]);
	manager = new RepoWatcherManager();
});

afterEach(async () => {
	await manager.disposeAll();
	rmSync(repoPath, { recursive: true, force: true });
});

describe("RepoWatcherManager", () => {
	test("returns same watcher for same path", async () => {
		const a = await manager.subscribe(repoPath, () => {});
		const b = await manager.subscribe(repoPath, () => {});
		expect(manager.activeCount(repoPath)).toBe(2);
		await a();
		expect(manager.activeCount(repoPath)).toBe(1);
		await b();
		expect(manager.activeCount(repoPath)).toBe(0);
	});

	test("closes watcher when last subscriber leaves", async () => {
		const off = await manager.subscribe(repoPath, () => {});
		expect(manager.isWatching(repoPath)).toBe(true);
		await off();
		expect(manager.isWatching(repoPath)).toBe(false);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/desktop && bun test tests/repo-watcher-manager.test.ts
```

Expected: FAIL — `RepoWatcherManager` not found.

- [ ] **Step 3: Commit failing test**

```bash
git add apps/desktop/tests/repo-watcher-manager.test.ts
git commit -m "test(repo-watcher-manager): failing tests for ref-counted registry"
```

---

## Task 7: Implement RepoWatcherManager

**Files:**
- Create: `apps/desktop/src/main/git/repo-watcher-manager.ts`

- [ ] **Step 1: Write implementation**

```ts
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
```

- [ ] **Step 2: Run test**

```bash
cd apps/desktop && bun test tests/repo-watcher-manager.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/git/repo-watcher-manager.ts
git commit -m "feat(repo-watcher): ref-counted RepoWatcherManager"
```

---

## Task 8: Wire IPC — preload bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`

- [ ] **Step 1: Add `repoAPI`**

Insert after the `settingsAPI` block, before the `contextBridge.exposeInMainWorld` call:

```ts
const repoAPI: RepoAPI = {
	subscribe: (repoPath: string) => ipcRenderer.invoke("repo:subscribe", repoPath),
	unsubscribe: (repoPath: string) => ipcRenderer.invoke("repo:unsubscribe", repoPath),
	onInvalidate: (callback) => {
		const handler = (_event: Electron.IpcRendererEvent, payload: RepoInvalidateEvent) => {
			callback(payload);
		};
		ipcRenderer.on("repo:invalidate", handler);
		return () => {
			ipcRenderer.removeListener("repo:invalidate", handler);
		};
	},
};
```

- [ ] **Step 2: Update imports at top of file**

```ts
import type {
	AgentAlertAPI,
	DaemonAPI,
	DialogAPI,
	LspAPI,
	RepoAPI,
	RepoInvalidateEvent,
	SessionAPI,
	SessionSaveData,
	SettingsAPI,
	ShellAPI,
	TerminalAPI,
	TrpcAPI,
} from "../shared/types";
```

- [ ] **Step 3: Add `repo: repoAPI` to `contextBridge.exposeInMainWorld`**

```ts
contextBridge.exposeInMainWorld("electron", {
	terminal: terminalAPI,
	trpc: trpcAPI,
	dialog: dialogAPI,
	session: sessionAPI,
	shell: shellAPI,
	lsp: lspAPI,
	daemon: daemonAPI,
	agentAlert: agentAlertAPI,
	settings: settingsAPI,
	repo: repoAPI,
});
```

- [ ] **Step 4: Verify type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: no errors. (If `window.electron.repo` is referenced anywhere already, the global typing in `src/renderer/types/electron.d.ts` or equivalent may also need updating — search for it and add `repo: RepoAPI` to the global `Window["electron"]` shape.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/types/electron.d.ts
git commit -m "feat(repo-watcher): expose repo IPC bridge in preload"
```

---

## Task 9: Wire IPC — main side

**Files:**
- Create: `apps/desktop/src/main/repo-ipc.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Create `repo-ipc.ts`**

```ts
import { type BrowserWindow, ipcMain } from "electron";
import { log } from "./logger";
import { RepoWatcherManager } from "./git/repo-watcher-manager";
import type { RepoInvalidateEvent } from "../shared/types";

let manager: RepoWatcherManager | null = null;
const subscriptionsByWindow = new WeakMap<BrowserWindow, Map<string, () => Promise<void>>>();

export function setupRepoIPC(getMainWindow: () => BrowserWindow | null): void {
	manager = new RepoWatcherManager();

	ipcMain.handle("repo:subscribe", async (event, repoPath: unknown) => {
		if (typeof repoPath !== "string" || repoPath.length === 0) return;
		const window = event.sender.getOwnerBrowserWindow?.() ?? getMainWindow();
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
		if (perWindow.has(repoPath)) return; // already subscribed

		const unsubscribe = await manager!.subscribe(repoPath, (e) => {
			if (window.isDestroyed()) return;
			const payload: RepoInvalidateEvent = { repoPath, kinds: e.kinds };
			window.webContents.send("repo:invalidate", payload);
		});
		perWindow.set(repoPath, unsubscribe);
	});

	ipcMain.handle("repo:unsubscribe", async (event, repoPath: unknown) => {
		if (typeof repoPath !== "string") return;
		const window = event.sender.getOwnerBrowserWindow?.() ?? getMainWindow();
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

export function getRepoStateBumpListener(): (e: RepoInvalidateEvent) => void {
	return (e) => log.info(`[repo] state bumped for ${e.repoPath}: ${e.kinds.join(",")}`);
}
```

> Note: `getOwnerBrowserWindow` is not part of Electron's typed API; the runtime `BrowserWindow.fromWebContents(event.sender)` form used in `terminal/ipc.ts` is the correct equivalent. Replace the `event.sender.getOwnerBrowserWindow?.()` lines with `BrowserWindow.fromWebContents(event.sender)` and import `BrowserWindow` from electron — the example above is illustrative.

- [ ] **Step 2: Wire into `apps/desktop/src/main/index.ts`**

After `setupTRPCIPC(appRouter);` (around line 170), add:

```ts
setupRepoIPC(() => mainWindow);
```

In the `before-quit` handler (around line 336), add:

```ts
await disposeRepoIPC();
```

Add corresponding imports:

```ts
import { setupRepoIPC, disposeRepoIPC } from "./repo-ipc";
```

- [ ] **Step 3: Verify type-check + lint**

```bash
cd apps/desktop && bun run type-check && bun run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/repo-ipc.ts apps/desktop/src/main/index.ts
git commit -m "feat(repo-watcher): wire main-side IPC for repo invalidation"
```

---

## Task 10: Renderer hook `useRepoSubscription`

**Files:**
- Create: `apps/desktop/src/renderer/hooks/useRepoSubscription.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from "react";
import { trpc } from "../trpc/client";
import type { RepoChangeKind } from "../../shared/types";

const KIND_TO_INVALIDATIONS: Record<RepoChangeKind, ReadonlyArray<"workingTree" | "branch" | "commits" | "branchStatus">> = {
	"working-tree": ["workingTree"],
	index: ["workingTree"],
	head: ["workingTree", "branch", "commits", "branchStatus"],
	refs: ["branch", "commits", "branchStatus"],
	state: ["branchStatus"],
};

export function useRepoSubscription(repoPath: string | null | undefined): void {
	const utils = trpc.useUtils();

	useEffect(() => {
		if (!repoPath) return;
		void window.electron.repo.subscribe(repoPath);

		const off = window.electron.repo.onInvalidate((event) => {
			if (event.repoPath !== repoPath) return;
			const targets = new Set<string>();
			for (const k of event.kinds) for (const t of KIND_TO_INVALIDATIONS[k]) targets.add(t);

			if (targets.has("workingTree")) {
				utils.diff.getWorkingTreeStatus.invalidate({ repoPath });
				utils.diff.getWorkingTreeDiff.invalidate({ repoPath });
			}
			if (targets.has("branch")) {
				utils.diff.getBranchDiff.invalidate({ repoPath });
			}
			if (targets.has("commits")) {
				utils.diff.getCommitsAhead.invalidate({ repoPath });
			}
			if (targets.has("branchStatus")) {
				utils.branches.getStatus.invalidate();
			}
		});

		return () => {
			off();
			void window.electron.repo.unsubscribe(repoPath);
		};
	}, [repoPath, utils]);
}
```

- [ ] **Step 2: Verify type-check**

```bash
cd apps/desktop && bun run type-check
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/hooks/useRepoSubscription.ts
git commit -m "feat(repo-watcher): add useRepoSubscription renderer hook"
```

---

## Task 11: Replace `refetchInterval` in DiffPanel

**Files:**
- Modify: `apps/desktop/src/renderer/components/DiffPanel.tsx:110-122`

- [ ] **Step 1: Mount the hook + drop intervals**

Replace lines 110–122 with:

```tsx
useRepoSubscription(diffCtx.repoPath);

const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
	{ repoPath: diffCtx.repoPath },
	{
		enabled: diffCtx.type === "working-tree",
		staleTime: 30_000,
		refetchOnWindowFocus: true,
	}
);

const branchStatusQuery = trpc.branches.getStatus.useQuery(
	{ projectId: projectId ?? "", cwd: activeWorkspaceCwd || undefined },
	{ enabled: !!projectId, staleTime: 30_000 }
);
```

Add at top of file:

```tsx
import { useRepoSubscription } from "../hooks/useRepoSubscription";
```

- [ ] **Step 2: Verify type-check + lint**

```bash
cd apps/desktop && bun run type-check && bun run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/DiffPanel.tsx
git commit -m "perf(diff-panel): replace 2s polling with watcher invalidation"
```

---

## Task 12: Replace `refetchInterval` in BranchChanges

**Files:**
- Modify: `apps/desktop/src/renderer/components/BranchChanges.tsx:58-61`

- [ ] **Step 1: Mount the hook + drop interval**

Replace lines 58–61 with:

```tsx
useRepoSubscription(repoPath);

const branchDiffQuery = trpc.diff.getBranchDiff.useQuery(
	{ repoPath, baseBranch, headBranch: currentBranch },
	{ staleTime: 30_000, refetchOnWindowFocus: true }
);
```

Add the import.

- [ ] **Step 2: Verify**

```bash
cd apps/desktop && bun run type-check && bun run lint
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/BranchChanges.tsx
git commit -m "perf(branch-changes): replace 2s polling with watcher invalidation"
```

---

## Task 13: Replace `refetchInterval` in CommittedStack + BranchChip

**Files:**
- Modify: `apps/desktop/src/renderer/components/CommittedStack.tsx:134-137`
- Modify: `apps/desktop/src/renderer/components/BranchChip.tsx:9-12`

- [ ] **Step 1: CommittedStack**

Replace lines 134–137 with:

```tsx
useRepoSubscription(repoPath);

const commitsQuery = trpc.diff.getCommitsAhead.useQuery(
	{ repoPath, baseBranch },
	{ staleTime: 30_000 }
);
```

Add the import.

- [ ] **Step 2: BranchChip**

The component receives `projectId` only — it has no `repoPath`. Two options:
1. Look up `repoPath` from the `projects.list` cache the way DiffPanel does. (Preferred — keep the hook centred on `repoPath`.)
2. Add an alternate `useProjectSubscription(projectId)` that resolves the path internally.

Pick option 1. Replace lines 5–12 of `BranchChip.tsx` with:

```tsx
import { useBranchStore } from "../stores/branch-store";
import { useTabStore } from "../stores/tab-store";
import { useRepoSubscription } from "../hooks/useRepoSubscription";
import { trpc } from "../trpc/client";

export function BranchChip({ projectId }: { projectId: string }) {
	const openPalette = useBranchStore((s) => s.openPalette);
	const cwd = useTabStore((s) => s.activeWorkspaceCwd);

	const projectsQuery = trpc.projects.list.useQuery(undefined, { staleTime: 60_000 });
	const repoPath = projectsQuery.data?.find((p) => p.id === projectId)?.repoPath ?? null;
	useRepoSubscription(repoPath);

	const statusQuery = trpc.branches.getStatus.useQuery(
		{ projectId, cwd: cwd || undefined },
		{ staleTime: 30_000 }
	);
```

Leave the rest of the component unchanged.

- [ ] **Step 3: Verify**

```bash
cd apps/desktop && bun run type-check && bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/CommittedStack.tsx apps/desktop/src/renderer/components/BranchChip.tsx
git commit -m "perf(committed-stack,branch-chip): replace 2s polling with watcher invalidation"
```

---

## Task 14: Replace `refetchInterval` in ReviewTab + App.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/components/review/ReviewTab.tsx:41-50`
- Modify: `apps/desktop/src/renderer/App.tsx:444`

- [ ] **Step 1: ReviewTab**

Replace lines 41–50 with:

```tsx
useRepoSubscription(repoPath);

const statusQuery = trpc.diff.getWorkingTreeStatus.useQuery(
	{ repoPath },
	{ staleTime: 30_000, refetchOnWindowFocus: true }
);
const currentBranch = statusQuery.data?.branch ?? "";

const branchQuery = trpc.diff.getBranchDiff.useQuery(
	{ repoPath, baseBranch, headBranch: currentBranch },
	{ enabled: !!currentBranch, staleTime: 30_000 }
);
```

Add the import.

- [ ] **Step 2: App.tsx**

Locate the `branchStatusQuery` at line 444 and drop its `refetchInterval`. Add `useRepoSubscription(activeRepoPath)` (whichever variable holds the active repo path in scope) near the top of `App` if not already present.

- [ ] **Step 3: Verify**

```bash
cd apps/desktop && bun run type-check && bun run lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/components/review/ReviewTab.tsx apps/desktop/src/renderer/App.tsx
git commit -m "perf(review-tab,app): replace 2s polling with watcher invalidation"
```

---

## Task 15: Failing test for `git-cache.ts`

**Files:**
- Create: `apps/desktop/tests/git-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { createGitCache } from "../src/main/git/git-cache";

describe("git-cache", () => {
	test("returns cached value when version unchanged", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = () => {
			calls++;
			return Promise.resolve({ a: 1 });
		};
		await cache.get("k", 1, compute);
		await cache.get("k", 1, compute);
		expect(calls).toBe(1);
	});

	test("recomputes when version changes", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = () => {
			calls++;
			return Promise.resolve({ a: calls });
		};
		await cache.get("k", 1, compute);
		await cache.get("k", 2, compute);
		expect(calls).toBe(2);
	});

	test("scopes by key", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = () => {
			calls++;
			return Promise.resolve({ a: 0 });
		};
		await cache.get("a", 1, compute);
		await cache.get("b", 1, compute);
		expect(calls).toBe(2);
	});

	test("dedupes concurrent calls for same (key,version)", async () => {
		let calls = 0;
		const cache = createGitCache<{ a: number }>();
		const compute = async () => {
			calls++;
			await new Promise((r) => setTimeout(r, 50));
			return { a: 1 };
		};
		await Promise.all([
			cache.get("k", 1, compute),
			cache.get("k", 1, compute),
			cache.get("k", 1, compute),
		]);
		expect(calls).toBe(1);
	});
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/desktop && bun test tests/git-cache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Commit failing test**

```bash
git add apps/desktop/tests/git-cache.test.ts
git commit -m "test(git-cache): failing tests for memo helper"
```

---

## Task 16: Implement `git-cache.ts`

**Files:**
- Create: `apps/desktop/src/main/git/git-cache.ts`

- [ ] **Step 1: Implement**

```ts
interface CacheEntry<T> {
	version: number;
	value: T;
}

export interface GitCache<T> {
	get(key: string, version: number, compute: () => Promise<T>): Promise<T>;
	clear(key?: string): void;
}

export function createGitCache<T>(): GitCache<T> {
	const entries = new Map<string, CacheEntry<T>>();
	const inflight = new Map<string, Promise<T>>();

	return {
		async get(key, version, compute) {
			const hit = entries.get(key);
			if (hit && hit.version === version) return hit.value;

			const inflightKey = `${key}@${version}`;
			const pending = inflight.get(inflightKey);
			if (pending) return pending;

			const promise = compute()
				.then((value) => {
					entries.set(key, { version, value });
					return value;
				})
				.finally(() => {
					inflight.delete(inflightKey);
				});
			inflight.set(inflightKey, promise);
			return promise;
		},
		clear(key) {
			if (key) entries.delete(key);
			else entries.clear();
		},
	};
}
```

- [ ] **Step 2: Run test**

```bash
cd apps/desktop && bun test tests/git-cache.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/git/git-cache.ts
git commit -m "feat(git-cache): version-keyed memo with inflight dedupe"
```

---

## Task 17: Per-repo state-version registry

**Files:**
- Create: `apps/desktop/src/main/git/repo-state-version.ts`
- Modify: `apps/desktop/src/main/repo-ipc.ts`

- [ ] **Step 1: Create version registry**

```ts
const versions = new Map<string, number>();

export function getRepoStateVersion(repoPath: string): number {
	return versions.get(repoPath) ?? 0;
}

export function bumpRepoStateVersion(repoPath: string): number {
	const next = (versions.get(repoPath) ?? 0) + 1;
	versions.set(repoPath, next);
	return next;
}
```

- [ ] **Step 2: Bump version on every watcher event in `repo-ipc.ts`**

In the listener registered inside `ipcMain.handle("repo:subscribe", ...)`, before the `webContents.send`:

```ts
bumpRepoStateVersion(repoPath);
```

Add the import.

- [ ] **Step 3: Verify type-check**

```bash
cd apps/desktop && bun run type-check
```

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/git/repo-state-version.ts apps/desktop/src/main/repo-ipc.ts
git commit -m "feat(repo-watcher): bump per-repo state version on FS events"
```

---

## Task 18: Failing test — `getBranchDiff` cache hit/miss

**Files:**
- Create: `apps/desktop/tests/get-branch-diff-cache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import { initRepo } from "../src/main/git/operations";
import { bumpRepoStateVersion } from "../src/main/git/repo-state-version";
import { getBranchDiffCached } from "../src/main/git/cached-ops";

const TEST_ROOT = realpathSync(tmpdir());

let repoPath: string;

beforeEach(async () => {
	repoPath = join(TEST_ROOT, `cache-test-${Date.now()}-${Math.random()}`);
	mkdirSync(repoPath, { recursive: true });
	await initRepo(repoPath, "main");
	await simpleGit(repoPath).raw(["commit", "--allow-empty", "-m", "init"]);
	await simpleGit(repoPath).checkoutLocalBranch("feature/x");
	writeFileSync(join(repoPath, "f.txt"), "x");
	await simpleGit(repoPath).add(["f.txt"]);
	await simpleGit(repoPath).commit("add f");
});

afterEach(() => {
	rmSync(repoPath, { recursive: true, force: true });
});

describe("getBranchDiffCached", () => {
	test("returns identical reference on cache hit", async () => {
		const a = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		const b = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		expect(b).toBe(a);
	});

	test("recomputes after state version bump", async () => {
		const a = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		bumpRepoStateVersion(repoPath);
		const b = await getBranchDiffCached({ repoPath, baseBranch: "main", headBranch: "feature/x" });
		expect(b).not.toBe(a);
	});
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/desktop && bun test tests/get-branch-diff-cache.test.ts
```

Expected: FAIL — module `cached-ops` not found.

- [ ] **Step 3: Commit failing test**

```bash
git add apps/desktop/tests/get-branch-diff-cache.test.ts
git commit -m "test(cached-ops): failing tests for getBranchDiff cache"
```

---

## Task 19: Implement cached wrappers

**Files:**
- Create: `apps/desktop/src/main/git/cached-ops.ts`
- Modify: `apps/desktop/src/main/trpc/routers/diff.ts`
- Modify: `apps/desktop/src/main/trpc/routers/branches.ts`

- [ ] **Step 1: Implement `cached-ops.ts`**

```ts
import simpleGit from "simple-git";
import { createGitCache } from "./git-cache";
import { getRepoStateVersion } from "./repo-state-version";
import { parseUnifiedDiff } from "./operations";
import { getBranchStatus } from "./branch-ops";
import { getCommitsAhead, getCurrentBranch, getUntrackedFiles } from "./operations";

const branchDiffCache = createGitCache<{ files: ReturnType<typeof parseUnifiedDiff>; stats: { added: number; removed: number; changed: number } }>();
const workingTreeStatusCache = createGitCache<{
	stagedFiles: ReturnType<typeof parseUnifiedDiff>;
	unstagedFiles: ReturnType<typeof parseUnifiedDiff>;
	branch: string;
}>();
const commitsAheadCache = createGitCache<Awaited<ReturnType<typeof getCommitsAhead>>>();
const branchStatusCache = createGitCache<Awaited<ReturnType<typeof getBranchStatus>>>();

function computeStats(files: ReturnType<typeof parseUnifiedDiff>) {
	return {
		added: files.filter((f) => f.status === "added").length,
		removed: files.filter((f) => f.status === "deleted").length,
		changed: files.filter((f) => f.status !== "added" && f.status !== "deleted").length,
	};
}

export async function getBranchDiffCached(input: { repoPath: string; baseBranch: string; headBranch: string }) {
	const key = `branch-diff:${input.repoPath}:${input.baseBranch}:${input.headBranch}`;
	return branchDiffCache.get(key, getRepoStateVersion(input.repoPath), async () => {
		const git = simpleGit(input.repoPath);
		const mergeBase = await git
			.raw(["merge-base", input.baseBranch, input.headBranch])
			.then((r) => r.trim())
			.catch(() => input.baseBranch);
		const rawDiff = await git.diff([
			`${mergeBase}..${input.headBranch}`,
			"--unified=3",
			"--no-color",
		]);
		const files = parseUnifiedDiff(rawDiff);
		return { files, stats: computeStats(files) };
	});
}

export async function getWorkingTreeStatusCached(input: { repoPath: string }) {
	const key = `wt-status:${input.repoPath}`;
	return workingTreeStatusCache.get(key, getRepoStateVersion(input.repoPath), async () => {
		const git = simpleGit(input.repoPath);
		const [stagedRaw, unstagedRaw, untrackedPaths, branch] = await Promise.all([
			git.diff(["--cached", "--unified=3", "--no-color"]),
			git.diff(["--unified=3", "--no-color"]),
			getUntrackedFiles(input.repoPath),
			getCurrentBranch(input.repoPath),
		]);
		const stagedFiles = parseUnifiedDiff(stagedRaw);
		const unstagedFiles = parseUnifiedDiff(unstagedRaw);
		for (const filePath of untrackedPaths) {
			unstagedFiles.push({ path: filePath, status: "added", additions: 0, deletions: 0, hunks: [] });
		}
		return { stagedFiles, unstagedFiles, branch };
	});
}

export async function getCommitsAheadCached(input: { repoPath: string; baseBranch: string }) {
	const key = `commits-ahead:${input.repoPath}:${input.baseBranch}`;
	return commitsAheadCache.get(key, getRepoStateVersion(input.repoPath), () =>
		getCommitsAhead(input.repoPath, input.baseBranch)
	);
}

export async function getBranchStatusCached(repoPath: string) {
	const key = `branch-status:${repoPath}`;
	return branchStatusCache.get(key, getRepoStateVersion(repoPath), () => getBranchStatus(repoPath));
}
```

- [ ] **Step 2: Run test**

```bash
cd apps/desktop && bun test tests/get-branch-diff-cache.test.ts
```

Expected: PASS for both "cache hit" and "recomputes after bump".

- [ ] **Step 3: Wire routers — `diff.ts`**

Replace the bodies of `getBranchDiff`, `getWorkingTreeStatus`, and `getCommitsAhead` to call the cached wrappers:

```ts
getBranchDiff: publicProcedure
	.input(z.object({ repoPath: z.string(), baseBranch: z.string(), headBranch: z.string() }))
	.query(({ input }) => getBranchDiffCached(input)),

getWorkingTreeStatus: publicProcedure
	.input(z.object({ repoPath: z.string() }))
	.query(({ input }) => getWorkingTreeStatusCached(input)),

getCommitsAhead: publicProcedure
	.input(z.object({ repoPath: z.string(), baseBranch: z.string() }))
	.query(({ input }) => getCommitsAheadCached(input)),
```

Add import:

```ts
import { getBranchDiffCached, getCommitsAheadCached, getWorkingTreeStatusCached } from "../../git/cached-ops";
```

(`getWorkingTreeDiff` does not need caching because no one currently polls it on a 2 s loop — leave it untouched.)

- [ ] **Step 4: Wire `branches.ts`**

In `getStatus`:

```ts
.query(async ({ input }) => {
	const path = await resolvePath(input.projectId, input.cwd);
	return getBranchStatusCached(path);
}),
```

Add import.

- [ ] **Step 5: Run full test suite**

```bash
cd apps/desktop && bun test
```

Expected: existing tests still pass; new tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/git/cached-ops.ts apps/desktop/src/main/trpc/routers/diff.ts apps/desktop/src/main/trpc/routers/branches.ts
git commit -m "perf(git): cache branch-diff/wt-status/commits-ahead/branch-status by state-version"
```

---

## Task 20: Drop `-uall` from polling caller

**Files:**
- Modify: `apps/desktop/src/main/git/operations.ts:218-227`

- [ ] **Step 1: Split into shallow + deep**

```ts
export async function getUntrackedFiles(repoPath: string): Promise<string[]> {
	const git = simpleGit(repoPath);
	// -unormal: only top-level entries of untracked dirs. Cheap on big repos.
	const status = await git.raw(["status", "--porcelain", "-unormal"]);
	return status
		.split("\n")
		.filter((line) => line.startsWith("?? "))
		.map((line) => line.slice(3).replace(/\/$/, ""));
}

export async function getUntrackedFilesDeep(repoPath: string): Promise<string[]> {
	const git = simpleGit(repoPath);
	const status = await git.raw(["status", "--porcelain", "-uall"]);
	return status
		.split("\n")
		.filter((line) => line.startsWith("?? "))
		.map((line) => line.slice(3).replace(/\/$/, ""));
}
```

- [ ] **Step 2: Find existing callers and route them**

```bash
cd apps/desktop && grep -rn "getUntrackedFiles" src/ tests/
```

Any caller that needs a complete recursive list (file-tree expand) → switch to `getUntrackedFilesDeep`. The `getWorkingTreeStatus` path stays on the shallow `getUntrackedFiles`.

- [ ] **Step 3: Run tests**

```bash
cd apps/desktop && bun test
```

Expected: all green. Fix any failure (likely a test that asserted recursive untracked listing).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/git/operations.ts
git commit -m "perf(git): use -unormal for status polls; -uall reserved for deep listing"
```

---

## Task 21: Manual verification on Portal

**Files:** none (verification step).

- [ ] **Step 1: Baseline measurement on `main`**

Stash this branch, return to `main`, open Portal, observe terminal lag and CPU/IPC traffic for ~60 s. Note approximate idle CPU%, IPC turn-around (you can use `console.time` markers or DevTools Performance tab on the renderer).

- [ ] **Step 2: Switch back to this branch + retest**

Run the full app:

```bash
bun run dev
```

Open Portal. Observe:
1. Idle CPU% (should drop noticeably; the main process should not spawn git processes once per 2 s).
2. Terminal typing/output latency in the integrated terminal under load.
3. Trigger one of each of: stage a file (expect status panel to update within ~250 ms), checkout a branch (expect branch chip + commits list to update), make an external commit via CLI (expect commits-ahead list to refresh).

- [ ] **Step 3: If a query feels stale**

Re-run the same operation and check the renderer console: `useRepoSubscription` debug logging (add a `console.debug` if needed during verification) should fire with the right kinds. If it does not fire, inspect chokidar paths (macOS uses fsevents — should not need polling).

- [ ] **Step 4: Document findings**

Add a short paragraph to the PR description with the before/after CPU and lag observations for the Portal repo.

- [ ] **Step 5: No commit needed for this task.**

---

## Task 22: Final type-check, lint, and full test sweep

- [ ] **Step 1: Run full sweep**

```bash
cd apps/desktop && bun run type-check && bun run lint && bun test
```

Expected: clean.

- [ ] **Step 2: Format**

```bash
cd /Users/Werk/Documents/Repositories/SuperiorSwarm-worktrees/laggy-big-repos-fix && bun run check
```

- [ ] **Step 3: Refresh graphify code graph** (per CLAUDE.md)

```bash
python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

- [ ] **Step 4: Commit any formatting / graph changes**

```bash
git add -A
git commit -m "chore: format + refresh graphify graph"
```

---

## Out of Scope (deferred)

- **`getBranchDiffSummary`** (name-status only, no hunks) — would further cut IPC payload size. Worth doing once watcher rollout proves stable; not required for the lag fix.
- **Replacing `getViewed` 10 s poll** — the DB query is cheap; leave as-is.
- **Settings to disable the watcher** for users on network filesystems where `fs.watch` is unreliable. Add only if a real report comes in.
- **Multi-window invalidation broadcast** — the app currently runs a single `mainWindow`; if multi-window is added later, switch `webContents.send` to iterate `BrowserWindow.getAllWindows()`.

---

## Self-Review Checklist (run before declaring plan complete)

1. Every task touching code includes the actual code in the step. ✓
2. No "TBD" / "implement later" / "similar to Task N". ✓
3. Type names are consistent: `RepoChangeKind`, `RepoInvalidateEvent`, `RepoAPI`, `RepoWatcher`, `RepoWatcherManager`, `getRepoStateVersion`, `bumpRepoStateVersion`, `createGitCache`, `getBranchDiffCached`, `getWorkingTreeStatusCached`, `getCommitsAheadCached`, `getBranchStatusCached`. ✓
4. Spec coverage:
   - "Replace polling with FS watcher" → Tasks 3-14. ✓
   - "Cache git results in main keyed by repo state version" → Tasks 15-19. ✓
   - "Drop `-uall` from `getUntrackedFiles`" → Task 20. ✓
   - "Verify in Portal" → Task 21. ✓
5. Each implementation task is preceded by a failing test where TDD is meaningful (watcher, manager, cache, cached-ops). UI rewiring tasks are validated by type-check/lint + manual Portal verification — appropriate because the behaviour is "fewer git invocations on idle", not a unit-testable functional change.
