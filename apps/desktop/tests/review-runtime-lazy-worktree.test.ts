import { expect, mock, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "agent-only worktree preparation")) {
	const { execFileSync } = await import("node:child_process");
	const { mkdtempSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { eq } = await import("drizzle-orm");
	const { makeTestDb } = await import("./test-db");
	const schema = await import("../src/main/db/schema");
	const { _setDbForTesting } = await import("../src/main/db");
	const directory = mkdtempSync(join(tmpdir(), "review-lazy-runtime-"));
	const root = join(directory, "repo");
	const tree = join(directory, "review");
	execFileSync("git", ["init", root], { stdio: "pipe" });
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
	writeFileSync(join(root, "file.ts"), "export const value = 1;\n");
	git("add", ".");
	git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
	const head = git("rev-parse", "HEAD");
	const db = makeTestDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({ id: "p", name: "Project", repoPath: root, createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.workspaces)
		.values({
			id: "w",
			projectId: "p",
			name: "PR",
			type: "review",
			prProvider: "github",
			prIdentifier: "o/r#1",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	_setDbForTesting(db);
	let mode: "cancel" | "success" | "unlinked" = "cancel";
	let entered: (() => void) | undefined;
	let captured: { signal?: AbortSignal; expectedHeadOid?: string } | undefined;
	mock.module("../src/main/ai-review/review-workspace", () => ({
		ensureReviewWorkspace: async (input: { signal?: AbortSignal; expectedHeadOid?: string }) => {
			captured = input;
			entered?.();
			if (mode === "cancel")
				await new Promise((_, reject) =>
					input.signal?.addEventListener("abort", () => reject(new Error("cancelled")), {
						once: true,
					})
				);
			if (mode === "success") {
				git("worktree", "add", "--detach", tree, head);
				db.insert(schema.worktrees)
					.values({
						id: "wt",
						projectId: "p",
						path: tree,
						branch: "feature",
						baseBranch: "main",
						createdAt: now,
						updatedAt: now,
					})
					.run();
				db.update(schema.workspaces)
					.set({ worktreeId: "wt" })
					.where(eq(schema.workspaces.id, "w"))
					.run();
			}
			return { workspaceId: "w", worktreePath: tree };
		},
	}));
	const { setTaskRegistry } = await import("../src/main/services/task-registry-handle");
	setTaskRegistry({ register: () => {} } as unknown as Parameters<typeof setTaskRegistry>[0]);
	const { setDaemonClient } = await import("../src/main/terminal/daemon-instance");
	const launches: string[] = [];
	setDaemonClient({
		isConnected: true,
		listSessionsStrict: async () => [],
		create: async (_id: string, cwd: string) => {
			launches.push(cwd);
		},
		write: () => true,
		dispose: () => {},
	} as unknown as Parameters<typeof setDaemonClient>[0]);
	const { registerGitProvider } = await import("../src/main/providers/git-provider");
	registerGitProvider({
		name: "github",
		getPRDetails: async () => ({
			title: "PR",
			author: "author",
			sourceBranch: "feature",
			targetBranch: "main",
			headCommitOid: head,
			files: [],
		}),
	} as unknown as Parameters<typeof registerGitProvider>[0]);
	const { ReviewPathStorage } = await import("../src/main/review-path/storage");
	const { getReviewPathRuntime } = await import("../src/main/review-path/runtime");
	const store = new ReviewPathStorage(db);
	const runtime = getReviewPathRuntime(store);
	const identity = {
		workspaceId: "w",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: head,
	};
	const agent = { id: "codex", label: "Codex" };
	test("Map prepares lazily, cancellation fences preparation, and no agent starts in the parent checkout", async () => {
		try {
			const run = store.begin(identity, agent, ["file.ts"]);
			const started = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const pending = runtime.startMapping({ run, agent, alsoReview: false });
			const rejected = pending.then(
				() => false,
				() => true
			);
			await Promise.race([
				started,
				pending.then(
					() => {
						throw new Error("Launch finished before preparation");
					},
					(error) => {
						throw error;
					}
				),
			]);
			expect(launches).toEqual([]);
			expect(captured?.expectedHeadOid).toBe(head);
			await runtime.stopMapping({ run });
			expect(await rejected).toBe(true);
			expect(captured?.signal?.aborted).toBe(true);
			store.fail(run, "cancelled");
			mode = "success";
			const next = store.begin(identity, agent, ["file.ts"]);
			const launch = await runtime.startMapping({ run: next, agent, alsoReview: false });
			expect(launch?.worktreePath).toBe(realpathSync(tree));
			expect(launches).toEqual([realpathSync(tree)]);
			expect(git("rev-parse", "HEAD")).toBe(head);
			store.fail(next, "fixture finished");
			mode = "unlinked";
			db.update(schema.workspaces)
				.set({ worktreeId: null })
				.where(eq(schema.workspaces.id, "w"))
				.run();
			const last = store.begin(identity, agent, ["file.ts"]);
			await expect(runtime.startMapping({ run: last, agent, alsoReview: false })).rejects.toThrow(
				"isolated review worktree"
			);
			expect(launches).toEqual([realpathSync(tree)]);
		} finally {
			_setDbForTesting(null);
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
