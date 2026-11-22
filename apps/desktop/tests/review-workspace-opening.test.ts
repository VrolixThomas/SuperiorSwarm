import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
import { fixtureGitEnv, snapshotFixture } from "./helpers/review-snapshot-fixture";

if (inIsolatedFileBrowserTest(import.meta.path, "exact review workspace opening")) {
	let networkCalls = 0;
	let resetCalls = 0;
	mock.module("simple-git", () => ({
		default: () => ({
			fetch: async () => {
				networkCalls++;
			},
			reset: async () => {
				resetCalls++;
			},
			raw: async () => {
				networkCalls++;
				throw Error("unexpected mutable branch operation");
			},
		}),
	}));
	mock.module("../src/main/services/worktree-deletion-coordinator", () => ({
		resumeWorktreeServices: () => {},
	}));
	const { makeTestDb } = await import("./test-db");
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const { workspacesRouter } = await import("../src/main/trpc/routers/workspaces");
	const { ReviewWorkspacePreparer } = await import(
		"../src/main/ai-review/review-workspace-preparation"
	);
	const { ensureReviewWorkspace } = await import("../src/main/ai-review/review-workspace");
	let fixture: ReturnType<typeof snapshotFixture>;
	let db: ReturnType<typeof makeTestDb>;
	const input = {
		projectId: "project",
		prProvider: "bitbucket" as const,
		prIdentifier: "org/repo#1",
		prTitle: "Review",
		sourceBranch: "feature/not-cached",
		targetBranch: "main",
	};
	beforeEach(() => {
		fixture = snapshotFixture();
		fixture.git("update-ref", "refs/remotes/origin/main", fixture.target);
		db = makeTestDb();
		_setDbForTesting(db);
		networkCalls = 0;
		resetCalls = 0;
		const now = new Date();
		db.insert(schema.projects)
			.values({ id: "project", name: "P", repoPath: fixture.root, createdAt: now, updatedAt: now })
			.run();
	});
	afterEach(() => {
		_setDbForTesting(null);
		rmSync(fixture.directory, { recursive: true, force: true });
	});

	test("opening an existing review never fetches, resets, or changes user work", async () => {
		const path = join(fixture.directory, "existing");
		fixture.git("worktree", "add", "--detach", path, fixture.head);
		writeFileSync(join(path, "new.txt"), "user changes");
		const now = new Date();
		db.insert(schema.worktrees)
			.values({
				id: "wt",
				projectId: "project",
				path,
				branch: "feature",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.workspaces)
			.values({
				id: "existing",
				projectId: "project",
				name: "Review",
				type: "review",
				worktreeId: "wt",
				prProvider: input.prProvider,
				prIdentifier: input.prIdentifier,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const result = await workspacesRouter.createCaller({}).getOrCreateReview(input);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(result.id).toBe("existing");
		expect(result.worktreePath).toBe(path);
		expect(networkCalls).toBe(0);
		expect(resetCalls).toBe(0);
		expect(readFileSync(join(path, "new.txt"), "utf8")).toBe("user changes");
		expect(
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: path,
				env: fixtureGitEnv,
				encoding: "utf8",
			}).trim()
		).toBe(fixture.head);
		expect(await ensureReviewWorkspace({ ...input, expectedHeadOid: fixture.head })).toEqual({
			workspaceId: "existing",
			worktreePath: path,
		});
		expect(networkCalls).toBe(0);
		expect(resetCalls).toBe(0);
	});

	test("new PR opens create one logical workspace without Git, provider access, or a worktree", async () => {
		const caller = workspacesRouter.createCaller({});
		const [first, second] = await Promise.all([
			caller.getOrCreateReview(input),
			caller.getOrCreateReview(input),
		]);
		expect(first.id).toBe(second.id);
		expect(first.worktreePath).toBeNull();
		expect(first.worktreeId).toBeNull();
		expect(db.select().from(schema.workspaces).all()).toHaveLength(1);
		expect(db.select().from(schema.worktrees).all()).toHaveLength(0);
		expect(networkCalls).toBe(0);
		expect(readdirSync(fixture.directory)).toEqual(["repo"]);
	});

	const sources = () => ({
		headOid: fixture.head,
		targetTipOid: fixture.target,
		headRepository: "org/repo",
		targetRepository: "org/repo",
	});
	test("agent preparation fetches the exact missing head once and creates one detached worktree", async () => {
		const root = join(fixture.directory, "consumer");
		execFileSync(
			"git",
			["clone", "--no-local", "--single-branch", "--branch", "main", fixture.root, root],
			{ env: fixtureGitEnv, stdio: "pipe" }
		);
		const git = (...args: string[]) =>
			execFileSync("git", args, {
				cwd: root,
				env: fixtureGitEnv,
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
		git("remote", "set-url", "origin", "https://bitbucket.org/org/repo.git");
		db.update(schema.projects).set({ repoPath: root }).run();
		const refs = git("show-ref");
		const fetches: string[][] = [];
		const firstProgress: unknown[] = [];
		const secondProgress: unknown[] = [];
		const preparer = new ReviewWorkspacePreparer({
			resolveSources: async () => sources(),
			getAuthorization: async () => "synthetic-authorization",
			fetchObjects: async (cwd, remote, oids, _signal, authorization, onProgress) => {
				onProgress?.({ stage: "receiving", percent: 20, current: 2, total: 10, bytes: 1024 });
				expect(cwd).toContain("consumer");
				expect(remote).toBe("https://bitbucket.org/org/repo.git");
				expect(authorization).toBe("synthetic-authorization");
				fetches.push(oids);
				git(
					"fetch",
					"--no-tags",
					"--no-write-fetch-head",
					"--refmap=",
					"--",
					fixture.root,
					...oids
				);
			},
		});
		const [first, second] = await Promise.all([
			preparer.open(input, {
				expectedHeadOid: fixture.head,
				onFetchProgress: (p) => firstProgress.push(p),
			}),
			preparer.open(input, {
				expectedHeadOid: fixture.head,
				onFetchProgress: (p) => secondProgress.push(p),
			}),
		]);
		expect(first.id).toBe(second.id);
		expect(first.worktreePath).toBe(second.worktreePath);
		expect(fetches).toEqual([[fixture.head]]);
		expect(firstProgress).toEqual([
			{ stage: "receiving", percent: 20, current: 2, total: 10, bytes: 1024 },
		]);
		expect(secondProgress).toEqual(firstProgress);
		expect(db.select().from(schema.worktrees).all()).toHaveLength(1);
		expect(db.select().from(schema.workspaces).all()).toHaveLength(1);
		expect(git("show-ref")).toBe(refs);
		expect(
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: first.worktreePath,
				env: fixtureGitEnv,
				encoding: "utf8",
			}).trim()
		).toBe(fixture.head);
		expect(() =>
			execFileSync("git", ["symbolic-ref", "HEAD"], {
				cwd: first.worktreePath,
				env: fixtureGitEnv,
				stdio: "pipe",
			})
		).toThrow();
		expect(readFileSync(join(first.worktreePath, "new.txt"), "utf8")).toBe("head only\n");
	});

	test("a late provider response after deadline cannot create or register a worktree", async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const preparer = new ReviewWorkspacePreparer({
			timeoutMs: 100,
			resolveSources: async () => {
				await pending;
				return sources();
			},
		});
		await expect(preparer.open(input)).rejects.toThrow("timed out");
		release();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(db.select().from(schema.worktrees).all()).toHaveLength(0);
		expect(db.select().from(schema.workspaces).all()[0]?.worktreeId).toBeNull();
		expect(existsSync(join(fixture.directory, "repo-worktrees"))).toBe(false);
	});

	test("metadata keeps its short deadline despite the longer transfer budget", async () => {
		let release: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const preparer = new ReviewWorkspacePreparer({
			metadataTimeoutMs: 15,
			resolveSources: async () => {
				await pending;
				return sources();
			},
		});
		await expect(preparer.open(input)).rejects.toThrow("metadata timed out");
		release?.();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(db.select().from(schema.worktrees).all()).toHaveLength(0);
	});

	test("provider head drift is rejected before checkout", async () => {
		const preparer = new ReviewWorkspacePreparer({ resolveSources: async () => sources() });
		await expect(preparer.open(input, { expectedHeadOid: "a".repeat(40) })).rejects.toThrow(
			"head changed"
		);
		expect(db.select().from(schema.worktrees).all()).toHaveLength(0);
	});

	test("cancelling one preparation consumer preserves another; cancelling all stops late work", async () => {
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const preparer = new ReviewWorkspacePreparer({
			resolveSources: async () => {
				await pending;
				return sources();
			},
		});
		const first = new AbortController();
		const second = new AbortController();
		const a = preparer.open(input, { signal: first.signal }).then(
			() => false,
			() => true
		);
		const b = preparer.open(input, { signal: second.signal });
		first.abort();
		expect(await a).toBe(true);
		release();
		expect((await b).worktreeId).toBeTruthy();
		const other = { ...input, prIdentifier: "org/repo#2" };
		const all = new AbortController();
		const cancelled = preparer.open(other, { signal: all.signal }).then(
			() => false,
			() => true
		);
		all.abort();
		expect(await cancelled).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(db.select().from(schema.worktrees).all()).toHaveLength(1);
	});

	test.each(["clean", "dirty", "untracked", "stale"])(
		"legacy checkout reviews fail closed for %s without modifying files",
		async (state) => {
			let moved = false;
			const preparer = new ReviewWorkspacePreparer({
				resolveSources: async () => ({
					...sources(),
					headOid: moved ? fixture.target : fixture.head,
				}),
			});
			const workspace = await preparer.open(input);
			if (state === "dirty")
				writeFileSync(join(workspace.worktreePath, "new.txt"), "keep these edits");
			if (state === "untracked")
				writeFileSync(join(workspace.worktreePath, "user.txt"), "keep this file");
			moved = state === "stale";
			const localGit = (...args: string[]) =>
				execFileSync("git", args, {
					cwd: workspace.worktreePath,
					env: fixtureGitEnv,
					encoding: "utf8",
				}).trim();
			const status = localGit("status", "--porcelain");
			if (state === "clean") expect((await preparer.open(input)).id).toBe(workspace.id);
			else
				await expect(preparer.open(input)).rejects.toThrow(
					state === "stale" ? "head differs" : "local changes"
				);
			expect(localGit("status", "--porcelain")).toBe(status);
			expect(localGit("rev-parse", "HEAD")).toBe(fixture.head);
			expect(db.select().from(schema.worktrees).all()).toHaveLength(1);
		}
	);

	test("cancelled local Git creation kills its subprocess group before any delayed write", async () => {
		const { runReviewWorktreeGit } = await import(
			"../src/main/ai-review/review-workspace-preparation"
		);
		const marker = join(fixture.directory, "late-write");
		const originalPath = process.env["PATH"];
		writeFileSync(
			join(fixture.directory, "git"),
			`#!/bin/sh\n(/bin/sleep 0.3; /usr/bin/touch '${marker}') &\nwait\n`,
			{ mode: 0o700 }
		);
		process.env["PATH"] = fixture.directory;
		const controller = new AbortController();
		try {
			const result = runReviewWorktreeGit(
				fixture.root,
				["worktree", "add"],
				controller.signal
			).then(
				() => false,
				() => true
			);
			await new Promise((resolve) => setTimeout(resolve, 20));
			controller.abort();
			expect(await result).toBe(true);
			await new Promise((resolve) => setTimeout(resolve, 350));
			expect(existsSync(marker)).toBe(false);
		} finally {
			process.env["PATH"] = originalPath;
		}
	});

	test.each(["missing", "stale"])(
		"legacy reviews reject a %s target ref for new and reused worktrees",
		async (state) => {
			const preparer = new ReviewWorkspacePreparer({ resolveSources: async () => sources() });
			const workspace = await preparer.open(input, { expectedHeadOid: fixture.head });
			if (state === "missing") fixture.git("update-ref", "-d", "refs/remotes/origin/main");
			else fixture.git("update-ref", "refs/remotes/origin/main", fixture.base);
			const refs = fixture.git("show-ref");
			await expect(preparer.open(input)).rejects.toThrow("current target base");
			await expect(preparer.open({ ...input, prIdentifier: "org/repo#2" })).rejects.toThrow(
				"current target base"
			);
			expect((await preparer.open(input, { expectedHeadOid: fixture.head })).id).toBe(workspace.id);
			expect(fixture.git("show-ref")).toBe(refs);
			expect(db.select().from(schema.worktrees).all()).toHaveLength(1);
		}
	);
}
