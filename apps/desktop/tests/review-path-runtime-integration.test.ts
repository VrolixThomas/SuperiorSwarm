import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"assembled reading-path runtime lifecycle in isolation"
	)
) {
	const { Database } = await import("bun:sqlite");
	const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { drizzle } = await import("drizzle-orm/bun-sqlite");
	const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
	const schema = await import("../src/main/db/schema");
	const { _setDbForTesting } = await import("../src/main/db");
	const { startControlPlane } = await import("../src/main/control-plane");
	const { setTaskRegistry } = await import("../src/main/services/task-registry-handle");
	const { setDaemonClient } = await import("../src/main/terminal/daemon-instance");
	const { registerGitProvider } = await import("../src/main/providers/git-provider");
	const { ReviewPathStorage } = await import("../src/main/review-path/storage");
	const { initializeReviewPathRuntime } = await import("../src/main/review-path/runtime");
	const { getReviewPathApplication } = await import("../src/main/review-path/service");
	const { createReviewPathRouter } = await import("../src/main/trpc/routers/review-path");
	const { registerReviewPathTools } = await import("../mcp-standalone/review-path.mjs");
	const { ownedTerminalId } = await import("../src/main/review-path/execution");
	test("startup fences survivors, retry uses new capability, Map and Ask persist only scoped results", async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-reading-runtime-"));
		const git = (...args: string[]) => {
			const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
			if (result.exitCode !== 0) throw Error(result.stderr.toString());
			return result.stdout.toString().trim();
		};
		git("init");
		writeFileSync(join(root, "a.ts"), "export const a=1;\n");
		git("add", "a.ts");
		git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
		const sha = git("rev-parse", "HEAD");
		const identity = {
			workspaceId: "w",
			provider: "github" as const,
			owner: "o",
			repo: "r",
			prNumber: 1,
			headSha: sha,
		};
		const sql = new Database(":memory:");
		const raw = drizzle(sql, { schema });
		migrate(raw, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		const db = raw as unknown as ReturnType<typeof import("../src/main/db").getDb>;
		const now = new Date();
		db.insert(schema.projects)
			.values({ id: "p", name: "isolated", repoPath: root, createdAt: now, updatedAt: now })
			.run();
		db.insert(schema.workspaces)
			.values({
				id: "w",
				projectId: "p",
				name: "review",
				type: "review",
				prProvider: "github",
				prIdentifier: "o/r#1",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.aiReviewSettings)
			.values({ id: "default", cliPreset: "codex", skipPermissions: 0, updatedAt: now })
			.run();
		_setDbForTesting(db);
		const store = new ReviewPathStorage(db);
		const agent = { id: "codex", label: "Codex" };
		const old = store.begin(identity, agent, ["a.ts"], { auto: true });
		store.attachTerminal(old, ownedTerminalId(old));
		const oldQuestion = store.enqueueQuestion(identity, { id: "old-q", text: "Previous question" });
		store.attachTerminal(oldQuestion.run, ownedTerminalId(oldQuestion.run));
		const oldCapability = store.grantCapability(old);
		const sessions = new Map([
			[ownedTerminalId(old), root],
			[ownedTerminalId(oldQuestion.run), root],
			["unrelated-review", root],
		]);
		let inventoryGate: Promise<void> | undefined;
		let failFirstInventory = true;
		let createGate: Promise<void> | undefined;
		let createEntered: (() => void) | undefined;
		let inventoryEntered: (() => void) | undefined;
		const writes: Array<{ id: string; data: string }> = [];
		const disposed: string[] = [];
		const daemon = {
			isConnected: true,
			listSessionsStrict: async () => {
				if (failFirstInventory) {
					failFirstInventory = false;
					throw new Error("Transient terminal inventory failure");
				}
				if (inventoryGate) {
					inventoryEntered?.();
					await inventoryGate;
				}
				return [...sessions].map(([id, cwd]) => ({ id, cwd, pid: 123 }));
			},
			create: async (id: string, cwd: string) => {
				sessions.set(id, cwd);
				if (createGate) {
					createEntered?.();
					await createGate;
				}
			},
			write: (id: string, data: string) => {
				writes.push({ id, data });
				return true;
			},
			dispose: (id: string) => {
				disposed.push(id);
				sessions.delete(id);
			},
		};
		setDaemonClient(daemon as unknown as import("../src/main/terminal/daemon-client").DaemonClient);
		let providerHead = sha;
		let filesComplete = true;
		let reads = 0;
		let holdOnRead = 0;
		let releaseRead: (() => void) | undefined;
		let enteredRead: (() => void) | undefined;
		let readGate: Promise<void> | undefined;
		const details = () => ({
			title: "Fixture PR",
			author: "author",
			sourceBranch: "feature",
			targetBranch: "main",
			headCommitOid: providerHead,
			files: [{ path: "a.ts", additions: 1, deletions: 0 }],
			filesComplete,
		});
		registerGitProvider({
			name: "github",
			getPRDetails: async () => {
				reads++;
				if (reads === holdOnRead) {
					enteredRead?.();
					await readGate;
				}
				return details();
			},
		} as unknown as import("../src/main/providers/types").GitProvider);
		const server = await startControlPlane({
			confirm: async () => {
				throw Error("No approval expected");
			},
			spawnFn: async () => {
				throw Error("No dispatch expected");
			},
		});
		setTaskRegistry(server.taskRegistry);
		const auth = { Authorization: `Bearer ${server.token}` };
		const handlersFor = async (
			launch: import("../src/shared/review-path-runtime").ReviewPathLaunchResult
		) => {
			if (!launch.launchScript) throw Error("Missing script");
			const script = readFileSync(launch.launchScript, "utf8");
			const token = /SUPERIORSWARM_TASK_TOKEN='([^']+)'/.exec(script)?.[1];
			if (!token) throw Error("Missing task token");
			const response = await fetch(
				`http://127.0.0.1:${server.port}/context.resolve?taskToken=${token}`,
				{ headers: auth }
			);
			expect(response.status).toBe(200);
			const context = await response.json();
			expect(context.mode).toBe("review-path");
			const handlers = new Map<
				string,
				(input: Record<string, unknown>) => Promise<{ isError?: boolean }>
			>();
			registerReviewPathTools(
				{
					tool: (
						name: string,
						_description: string,
						_schema: unknown,
						handler: (input: Record<string, unknown>) => Promise<{ isError?: boolean }>
					) => {
						handlers.set(name, handler);
					},
				} as unknown as Parameters<typeof registerReviewPathTools>[0],
				{ context, discovery: { port: server.port, token: server.token } }
			);
			return async (name: string, input: Record<string, unknown>) => {
				const handler = handlers.get(name);
				if (!handler) throw Error(`Missing tool ${name}`);
				return handler(input);
			};
		};
		try {
			await initializeReviewPathRuntime();
			expect(store.getRun(old.id)?.state).toBe("failed");
			expect(store.getRun(oldQuestion.run.id)?.state).toBe("failed");
			expect(() => store.authenticateCapability(oldCapability)).toThrow();
			expect(writes).toEqual([]);
			expect(disposed).not.toContain("unrelated-review");
			const caller = createReviewPathRouter(getReviewPathApplication).createCaller({});
			const duplicate = await caller.start({ identity, agent, alsoReview: false, auto: true });
			expect(duplicate.run.id).toBe(old.id);
			expect(duplicate.launch).toBeUndefined();
			const mapped = await caller.start({ identity, agent, alsoReview: true });
			expect(mapped.run.id).not.toBe(old.id);
			expect(mapped.launch?.terminalId).toBe(ownedTerminalId(mapped.run));
			expect(mapped.launch?.cliPreset).toBe("codex");
			if (!mapped.launch) throw Error("Missing mapping launch");
			const mapTool = await handlersFor(mapped.launch);
			const scope = { run_id: mapped.run.id, run_version: mapped.run.version };
			expect(
				(
					await mapTool("set_review_path", {
						...scope,
						entries: [
							{
								id: "entry",
								title: "Entry",
								steps: [
									{
										id: "a",
										kind: "changed",
										path: "a.ts",
										note: "Entry point",
										focus: [],
										tests: [],
									},
								],
							},
						],
						otherFiles: [],
					})
				).isError
			).not.toBe(true);
			expect((await caller.get({ identity })).path?.status).toBe("mapping");
			expect(
				(
					await mapTool("add_review_finding", {
						...scope,
						file_path: "a.ts",
						line_number: 1,
						side: "RIGHT",
						body: "Local finding",
					})
				).isError
			).not.toBe(true);
			expect((await mapTool("finish_review_path", scope)).isError).not.toBe(true);
			expect((await caller.get({ identity })).path?.status).toBe("ready");
			expect(db.select().from(schema.draftComments).all()).toHaveLength(1);
			expect(
				(await mapTool("set_review_path", { ...scope, entries: [], otherFiles: ["a.ts"] })).isError
			).toBe(true);
			const entered = new Promise<void>((resolve) => {
				enteredRead = resolve;
			});
			readGate = new Promise<void>((resolve) => {
				releaseRead = resolve;
			});
			holdOnRead = reads + 2;
			const cancelling = caller.start({ identity, agent, alsoReview: true });
			await entered;
			const cancellingRun = store.getActiveRuns().find((run) => run.kind === "mapping");
			if (!cancellingRun) throw Error("Missing preparing run");
			await caller.cancel({ identity, id: cancellingRun.id, version: cancellingRun.version });
			releaseRead?.();
			await expect(cancelling).rejects.toThrow();
			expect(db.select().from(schema.reviewDrafts).all()).toHaveLength(1);
			let releaseInventory: (() => void) | undefined;
			const inventoryStarted = new Promise<void>((resolve) => {
				inventoryEntered = resolve;
			});
			inventoryGate = new Promise<void>((resolve) => {
				releaseInventory = resolve;
			});
			const writesBeforeInventory = writes.length;
			const inventoryLaunch = caller.start({ identity, agent, alsoReview: false });
			await inventoryStarted;
			const inventoryRun = store.getActiveRuns().find((run) => run.kind === "mapping");
			if (!inventoryRun) throw Error("Missing inventory run");
			await caller.cancel({ identity, id: inventoryRun.id, version: inventoryRun.version });
			releaseInventory?.();
			inventoryGate = undefined;
			await expect(inventoryLaunch).rejects.toThrow();
			expect(writes.length).toBe(writesBeforeInventory);
			let releaseCreate: (() => void) | undefined;
			const creating = new Promise<void>((resolve) => {
				createEntered = resolve;
			});
			createGate = new Promise<void>((resolve) => {
				releaseCreate = resolve;
			});
			const creationLaunch = caller.start({ identity, agent, alsoReview: false });
			await creating;
			const creatingRun = store.getActiveRuns().find((run) => run.kind === "mapping");
			if (!creatingRun) throw Error("Missing creating run");
			await caller.cancel({ identity, id: creatingRun.id, version: creatingRun.version });
			releaseCreate?.();
			createGate = undefined;
			await expect(creationLaunch).rejects.toThrow();
			expect(writes.length).toBe(writesBeforeInventory);
			expect(
				db
					.select()
					.from(schema.terminalSessions)
					.all()
					.some((session) => session.id === ownedTerminalId(creatingRun))
			).toBe(false);
			const anchor = { path: "a.ts", side: "LEFT" as const, startLine: 1, endLine: 1 };
			const asked = await caller.ask({ identity, id: "q1", text: "Why?", anchor });
			if (!asked.launch) throw Error("Missing Ask launch");
			const askTool = await handlersFor(asked.launch);
			const askScope = { run_id: asked.run.id, run_version: asked.run.version };
			expect(
				(
					await askTool("answer_question", {
						...askScope,
						question_id: "wrong",
						text: "Wrong answer",
					})
				).isError
			).toBe(true);
			expect(
				(
					await askTool("answer_question", {
						...askScope,
						question_id: "q1",
						text: "Scoped answer",
						refs: [{ path: "a.ts", line: 1, description: "Entry" }],
					})
				).isError
			).not.toBe(true);
			const conversation = await caller.get({ identity });
			expect(conversation.questions.find((q) => q.id === "q1")?.state).toBe("answered");
			expect(conversation.messages.filter((m) => m.role === "agent").map((m) => m.text)).toEqual([
				"Scoped answer",
			]);
			const pending = await caller.ask({ identity, id: "q2", text: "Cancel me" });
			await caller.cancelQuestion({ identity, id: pending.run.id, version: pending.run.version });
			expect(disposed).toContain(ownedTerminalId(pending.run));
			expect(sessions.has("unrelated-review")).toBe(true);
			const remap = await caller.start({
				identity,
				agent: { id: "claude", label: "Claude Code" },
				alsoReview: false,
			});
			expect(remap.launch?.cliPreset).toBe("claude");
			const late = remap.launch ? await handlersFor(remap.launch) : undefined;
			writeFileSync(join(root, "a.ts"), "export const a=2;\n");
			git("add", "a.ts");
			git(
				"-c",
				"user.name=Test",
				"-c",
				"user.email=test@example.invalid",
				"commit",
				"-m",
				"new head"
			);
			providerHead = git("rev-parse", "HEAD");
			const newer = await caller.get({ identity: { ...identity, headSha: providerHead } });
			expect(newer.path?.status).toBe("stale");
			expect(store.getRun(remap.run.id)?.state).toBe("superseded");
			expect(
				(
					await late?.("finish_review_path", {
						run_id: remap.run.id,
						run_version: remap.run.version,
					})
				)?.isError
			).toBe(true);
			const newIdentity = { ...identity, headSha: providerHead };
			const writesBeforeOffline = writes.length;
			daemon.isConnected = false;
			await expect(
				caller.ask({ identity: newIdentity, id: "offline-q", text: "Offline question" })
			).rejects.toThrow("offline");
			expect(
				store.peek(newIdentity).questions.find((question) => question.id === "offline-q")?.state
			).toBe("failed");
			expect(
				store.peek(newIdentity).messages.filter((message) => message.role === "agent")
			).toHaveLength(1);
			expect(writes.length).toBe(writesBeforeOffline);
			daemon.isConnected = true;
			filesComplete = false;
			const runsBeforeIncomplete = store.peek(newIdentity).runs.length;
			await expect(
				caller.start({ identity: newIdentity, agent, alsoReview: false })
			).rejects.toThrow("coverage");
			expect(store.peek(newIdentity).runs).toHaveLength(runsBeforeIncomplete);
			expect(
				writes.every(
					(write) => write.id.startsWith("review-path:") && write.data.startsWith("exec /bin/bash ")
				)
			).toBe(true);
		} finally {
			await server.stop();
			_setDbForTesting(null);
			rmSync(root, { recursive: true, force: true });
		}
	});
}
