import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "read-only owned review terminal state")) {
	const { makeTestDb } = await import("./test-db");
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const { ReviewPathStorage } = await import("../src/main/review-path/storage");
	const { setDaemonClient } = await import("../src/main/terminal/daemon-instance");
	const { createReviewPathRouter } = await import("../src/main/trpc/routers/review-path");
	type Daemon = Parameters<typeof setDaemonClient>[0];
	let db: ReturnType<typeof makeTestDb>;
	let storage: InstanceType<typeof ReviewPathStorage>;
	let directory: string;
	let cwd: string;
	let other: string;
	let terminalId: string;
	let run: ReturnType<InstanceType<typeof ReviewPathStorage>["begin"]>;
	let inventories: number;
	let inventory: Array<{ id: string; cwd: string; pid: number }>;
	let duringInventory: () => void | Promise<void>;
	let daemon: { isConnected: boolean; listSessionsStrict: () => Promise<typeof inventory> };
	const identity = {
		workspaceId: "w",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	};
	const caller = createReviewPathRouter(() => {
		throw Error("Inspection must not instantiate the application");
	}).createCaller({});
	const inspect = () => caller.terminalState({ workspaceId: "w", terminalId });
	const registerSession = () =>
		db
			.insert(schema.terminalSessions)
			.values({
				id: terminalId,
				workspaceId: "w",
				cwd,
				title: "Agent",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
	const changes = () => db.$client.prepare("SELECT total_changes() AS count").get();
	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "review-terminal-state-"));
		cwd = join(directory, "review");
		other = join(directory, "other");
		mkdirSync(cwd);
		mkdirSync(other);
		cwd = realpathSync(cwd);
		other = realpathSync(other);
		db = makeTestDb();
		_setDbForTesting(db);
		const now = new Date();
		db.insert(schema.projects)
			.values({ id: "p", name: "P", repoPath: directory, createdAt: now, updatedAt: now })
			.run();
		db.insert(schema.worktrees)
			.values({
				id: "wt",
				projectId: "p",
				path: cwd,
				branch: "pr",
				baseBranch: "main",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		for (const id of ["w", "foreign"])
			db.insert(schema.workspaces)
				.values({
					id,
					projectId: "p",
					worktreeId: id === "w" ? "wt" : null,
					name: id,
					type: "review",
					prProvider: "github",
					prIdentifier: id === "w" ? "o/r#1" : "o/r#2",
					createdAt: now,
					updatedAt: now,
				})
				.run();
		storage = new ReviewPathStorage(db);
		run = storage.begin(identity, { id: "codex", label: "Codex" }, []);
		terminalId = `review-path:${run.id}:${run.version}`;
		storage.attachTerminal(run, terminalId);
		inventories = 0;
		inventory = [{ id: terminalId, cwd, pid: 123 }];
		duringInventory = () => {};
		daemon = {
			isConnected: true,
			listSessionsStrict: async () => {
				inventories++;
				await duringInventory();
				return inventory;
			},
		};
		setDaemonClient(daemon as Daemon);
	});
	afterEach(() => {
		setDaemonClient({ isConnected: false } as Daemon);
		_setDbForTesting(null);
		db.$client.close();
		rmSync(directory, { recursive: true, force: true });
	});

	test("completed run without a registered session reports ended without querying or writing", async () => {
		storage.finish(run);
		const before = changes();
		expect(await inspect()).toEqual({
			status: "ended",
			runState: "completed",
			message: "This agent run completed. Its terminal session has ended.",
		});
		expect(inventories).toBe(0);
		expect(changes()).toEqual(before);
	});

	test("valid live session is inspectable without any durable write", async () => {
		registerSession();
		const before = changes();
		expect(await inspect()).toMatchObject({ status: "available", runState: "running", cwd });
		expect(inventories).toBe(1);
		expect(changes()).toEqual(before);
		storage.finish(run);
		expect(await inspect()).toMatchObject({ status: "available", runState: "completed", cwd });
	});

	test("unknown, foreign and incorrect deterministic selectors fail before inventory without private details", async () => {
		registerSession();
		const before = changes();
		for (const input of [
			{ workspaceId: "foreign", terminalId },
			{ workspaceId: "w", terminalId: "review-path:unknown:1" },
			{ workspaceId: "w", terminalId: `review-path:${run.id}:${run.version + 1}` },
			{ workspaceId: "w", terminalId: "ordinary-shell" },
		])
			expect(await caller.terminalState(input)).toEqual({
				status: "unavailable",
				message: "This agent terminal is unavailable for this review workspace.",
			});
		expect(inventories).toBe(0);
		expect(changes()).toEqual(before);
	});

	test("wrong provider binding rejects before daemon inventory", async () => {
		registerSession();
		db.update(schema.workspaces)
			.set({ prProvider: "bitbucket" })
			.where(eq(schema.workspaces.id, "w"))
			.run();
		expect(await inspect()).toEqual({
			status: "unavailable",
			message: "This agent terminal is unavailable for this review workspace.",
		});
		expect(inventories).toBe(0);
	});

	test("registered session whose PTY disappeared is ended, with no repair mutations", async () => {
		registerSession();
		inventory = [];
		const before = changes();
		expect(await inspect()).toMatchObject({ status: "ended", runState: "running" });
		expect(changes()).toEqual(before);
		expect(db.select().from(schema.terminalSessions).all()).toHaveLength(1);
	});

	for (const offline of [false, true])
		test(`daemon ${offline ? "offline" : "inventory error"} stays unavailable rather than claiming exit`, async () => {
			registerSession();
			daemon.isConnected = !offline;
			duringInventory = () => {
				throw Error("private daemon path /secret/socket");
			};
			const before = changes();
			const result = await inspect();
			expect(result).toEqual({
				status: "unavailable",
				runState: "running",
				message: "The terminal service is unavailable. Try again shortly.",
			});
			expect(inventories).toBe(offline ? 0 : 1);
			expect(changes()).toEqual(before);
		});

	for (const race of [
		"workspace",
		"session-owner",
		"session-cwd",
		"workspace-cwd",
		"run-terminal",
		"daemon",
	] as const)
		test(`identity race during inventory rejects ${race}`, async () => {
			registerSession();
			duringInventory = () => {
				if (race === "workspace")
					db.update(schema.workspaces)
						.set({ prIdentifier: "o/r#3" })
						.where(eq(schema.workspaces.id, "w"))
						.run();
				if (race === "session-owner")
					db.update(schema.terminalSessions)
						.set({ workspaceId: "foreign" })
						.where(eq(schema.terminalSessions.id, terminalId))
						.run();
				if (race === "session-cwd")
					db.update(schema.terminalSessions)
						.set({ cwd: other })
						.where(eq(schema.terminalSessions.id, terminalId))
						.run();
				if (race === "workspace-cwd")
					db.update(schema.worktrees)
						.set({ path: other })
						.where(eq(schema.worktrees.id, "wt"))
						.run();
				if (race === "run-terminal") storage.attachTerminal(run, `${terminalId}-replacement`);
				if (race === "daemon") daemon.isConnected = false;
			};
			const result = await inspect();
			expect(result.status).toBe("unavailable");
			expect(result.cwd).toBeUndefined();
			if (race !== "daemon") expect(result.runState).toBeUndefined();
		});

	test("session row removed while inventory is pending reports ended for the still-owned run", async () => {
		registerSession();
		duringInventory = () => {
			storage.finish(run);
			db.delete(schema.terminalSessions).where(eq(schema.terminalSessions.id, terminalId)).run();
		};
		expect(await inspect()).toMatchObject({ status: "ended", runState: "completed" });
	});

	test("a live PTY in a different directory is unavailable without exposing its cwd", async () => {
		registerSession();
		inventory = [{ id: terminalId, cwd: other, pid: 123 }];
		expect(await inspect()).toEqual({
			status: "unavailable",
			message: "This agent terminal is unavailable for this review workspace.",
		});
	});
}
