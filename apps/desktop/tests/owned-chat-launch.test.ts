import "./preload-electron-mock";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { projects, terminalSessions, workspaces, worktrees } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import {
	getAgentSessionManager,
	setAgentSessionManager,
} from "../src/main/services/agent-session-manager-handle";
import { startOwnedChat } from "../src/main/services/owned-chat";
import {
	type SpawnArgs,
	defaultSpawnFn,
	setDispatchBroadcaster,
} from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { agentLaunchRouter } from "../src/main/trpc/routers/agent-launch";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
const directories: string[] = [];
const managers: AgentSessionManager[] = [];
let previous: ReturnType<typeof getAgentSessionManager>;
afterEach(() => {
	for (const manager of managers.splice(0)) manager.dispose();
	setAgentSessionManager(previous ?? null);
	setDispatchBroadcaster(() => {
		throw Error("No test broadcaster");
	});
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});
function directory() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "owned-chat-launch-")));
	directories.push(root);
	return root;
}
async function fixture(kind: "worktree" | "folder" | "orchestrator" | "coordinator") {
	const cwd = directory();
	const projectId = await seedProject();
	getDb()
		.update(projects)
		.set({ repoPath: cwd, kind: kind === "folder" ? "folder" : "repo" })
		.where(eq(projects.id, projectId))
		.run();
	let workspaceId: string;
	if (kind === "coordinator") {
		workspaceId = await seedCrossRepoOrchestrator({ workDir: cwd, projectIds: [projectId] });
	} else {
		workspaceId = await seedWorkspace(projectId, {
			name: "Own chat",
			type: "branch",
			isOrchestrator: kind === "orchestrator",
		});
		if (kind === "folder")
			getDb()
				.update(workspaces)
				.set({ type: "folder", folderPath: cwd })
				.where(eq(workspaces.id, workspaceId))
				.run();
		if (kind === "worktree") {
			const worktreeId = randomUUID();
			getDb()
				.insert(worktrees)
				.values({
					id: worktreeId,
					projectId,
					path: cwd,
					branch: "owned",
					baseBranch: "main",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.run();
			getDb()
				.update(workspaces)
				.set({ type: "worktree", worktreeId })
				.where(eq(workspaces.id, workspaceId))
				.run();
		}
	}
	const registrations: unknown[] = [];
	const manager = new AgentSessionManager({
		daemonClient: {
			queueRegisterLaunch: async (...args: unknown[]) => {
				registrations.push(args);
				return true;
			},
		} as unknown as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	previous = getAgentSessionManager();
	setAgentSessionManager(manager);
	managers.push(manager);
	const dispatchedId = randomUUID();
	getDb()
		.insert(terminalSessions)
		.values({
			id: dispatchedId,
			workspaceId,
			title: "Existing dispatched agent",
			cwd,
			sortOrder: 0,
			updatedAt: new Date(),
		})
		.run();
	manager.registerManagedSession({
		terminalId: dispatchedId,
		workspaceId,
		provider: "codex",
		providerSessionId: randomUUID(),
		skipPermissions: false,
	});
	return { cwd, workspaceId, manager, registrations, dispatchedId };
}

for (const provider of ["claude", "codex"] as const)
	for (const kind of ["worktree", "folder", "orchestrator", "coordinator"] as const) {
		test(`${provider} own chat in ${kind}: exact cwd/policy/nonce without hijacking dispatch`, async () => {
			const f = await fixture(kind);
			let broadcasts = 0;
			setDispatchBroadcaster(() => {
				broadcasts++;
			});
			let requested: SpawnArgs | undefined;
			const launch = await startOwnedChat(
				{ workspaceId: f.workspaceId, provider },
				{
					spawn: async (args) => {
						requested = args;
						return defaultSpawnFn(args);
					},
				}
			);
			directories.push(dirname(launch.scriptPath));
			expect(launch).toMatchObject({
				workspaceId: f.workspaceId,
				cwd: f.cwd,
				title: provider === "claude" ? "Claude chat" : "Codex chat",
			});
			expect(broadcasts).toBe(0); // The explicit caller creates the terminal before writing.
			expect(requested?.agent).toMatchObject({
				provider,
				managed: false,
				skipPermissions: false,
				initialPrompt: false,
			});
			expect(f.manager.getSession(launch.terminalId)).toMatchObject({
				workspaceId: f.workspaceId,
				provider,
				managed: false,
				skipPermissions: false,
			});
			expect(f.manager.getSession(f.dispatchedId)?.managed).toBe(true);
			const script = readFileSync(launch.scriptPath, "utf8");
			expect(script).toContain(
				`AGENT_NOTIFY_LAUNCH_ID='${requested?.agent?.queueLaunchId}' exec ${provider}`
			);
			expect(script).not.toContain("dangerously");
			expect(script).not.toContain("approval_policy=never");
			expect(script).not.toContain("SYNTHETIC");
			if (provider === "codex") expect(script).toContain("codex --no-daemon");
			// No positional prompt was manufactured; the command ends with provider/session options.
			expect(script.trimEnd()).not.toEndWith("''");
			expect(f.registrations).toEqual([]);
			const sessionId = f.manager.getSession(launch.terminalId)?.providerSessionId ?? randomUUID();
			const event = {
				terminalId: launch.terminalId,
				sessionId: launch.terminalId,
				workspaceId: f.workspaceId,
				providerSessionId: sessionId,
				agent: provider,
				alert: "active" as const,
				rawEvent: "SessionStart",
				sessionSource: "startup",
				cwd: f.cwd,
				timestamp: Date.now() + 2,
			};
			f.manager.handleAgentEvent({ ...event, launchId: randomUUID() });
			await Promise.resolve();
			expect(f.registrations).toEqual([]);
			f.manager.handleAgentEvent({
				...event,
				timestamp: event.timestamp + 1,
				launchId: requested?.agent?.queueLaunchId,
			});
			await Promise.resolve();
			await Promise.resolve();
			expect(f.registrations).toHaveLength(1);
			expect(f.registrations[0]).toEqual([
				launch.terminalId,
				expect.objectContaining({
					terminalId: launch.terminalId,
					workspaceId: f.workspaceId,
					provider,
					providerSessionId: sessionId,
				}),
				expect.objectContaining({ provider, initialPrompt: false }),
			]);
		});
	}

test("deleted workspace and missing folder reject before preparing a launch", async () => {
	const f = await fixture("folder");
	let spawns = 0;
	const spawn = async () => {
		spawns++;
		throw Error("must not spawn");
	};
	await expect(
		startOwnedChat({ workspaceId: "missing-owner", provider: "claude" }, { spawn })
	).rejects.toThrow("no longer available");
	rmSync(f.cwd, { recursive: true, force: true });
	await expect(
		startOwnedChat({ workspaceId: f.workspaceId, provider: "codex" }, { spawn })
	).rejects.toThrow();
	expect(spawns).toBe(0);
});

test("the public start API rejects caller-supplied cwd, binary, argv and permission override", async () => {
	const f = await fixture("folder");
	const caller = agentLaunchRouter.createCaller({});
	for (const extra of [
		{ cwd: "/different" },
		{ binary: "/bin/sh" },
		{ args: ["-c", "echo bad"] },
		{ skipPermissions: true },
	]) {
		await expect(
			caller.startChat({ workspaceId: f.workspaceId, provider: "codex", ...extra })
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	}
});

test("failed owned registration removes only the newly prepared terminal", async () => {
	const f = await fixture("worktree");
	const before = getDb()
		.select()
		.from(terminalSessions)
		.all()
		.map((row) => row.id)
		.sort();
	const original = f.manager.registerManagedSession.bind(f.manager);
	f.manager.registerManagedSession = (input) => {
		if (input.managed === false) throw Error("synthetic registration failure");
		return original(input);
	};
	await expect(startOwnedChat({ workspaceId: f.workspaceId, provider: "claude" })).rejects.toThrow(
		"synthetic registration failure"
	);
	expect(
		getDb()
			.select()
			.from(terminalSessions)
			.all()
			.map((row) => row.id)
			.sort()
	).toEqual(before);
	expect(f.manager.getSession(f.dispatchedId)?.managed).toBe(true);
});

for (const provider of ["claude", "codex"] as const) {
	test(`${provider} explicit ticket prompt is shell-quoted, bounded and reflected in launch descriptor`, async () => {
		const f = await fixture("folder");
		let requested: SpawnArgs | undefined;
		const prompt = "Start SUP-39: user's ticket.\nhttps://linear.app/swarm/issue/SUP-39";
		const launch = await startOwnedChat(
			{ workspaceId: f.workspaceId, provider, initialPrompt: `  ${prompt}  ` },
			{
				spawn: async (args) => {
					requested = args;
					return defaultSpawnFn(args);
				},
			}
		);
		directories.push(dirname(launch.scriptPath));
		expect(requested?.agent).toMatchObject({
			provider,
			initialPrompt: true,
			managed: false,
			skipPermissions: false,
		});
		const script = readFileSync(launch.scriptPath, "utf8");
		expect(script).toContain("Start SUP-39: user'\\''s ticket.");
		expect(script).toContain("https://linear.app/swarm/issue/SUP-39");
		expect(script).not.toContain("dangerously");
		expect(f.manager.getSession(f.dispatchedId)?.managed).toBe(true);
		await expect(
			startOwnedChat({ workspaceId: f.workspaceId, provider, initialPrompt: "x".repeat(4001) })
		).rejects.toThrow("4,000");
	});
}
test("whitespace initial prompt stays promptless; leading flag is treated as user text", async () => {
	const f = await fixture("folder");
	for (const initialPrompt of ["   ", "--help"]) {
		let requested: SpawnArgs | undefined;
		const launch = await startOwnedChat(
			{ workspaceId: f.workspaceId, provider: "codex", initialPrompt },
			{
				spawn: async (args) => {
					requested = args;
					return defaultSpawnFn(args);
				},
			}
		);
		directories.push(dirname(launch.scriptPath));
		expect(requested?.agent?.initialPrompt).toBe(initialPrompt === "--help");
		if (initialPrompt === "--help")
			expect(readFileSync(launch.scriptPath, "utf8")).toContain("'User request:\n--help'");
	}
});

for (const provider of ["claude", "codex"] as const) {
	test(`${provider} own chat cannot start in an unprepared logical PR root`, async () => {
		const f = await fixture("orchestrator");
		getDb()
			.update(workspaces)
			.set({ type: "review", worktreeId: null })
			.where(eq(workspaces.id, f.workspaceId))
			.run();
		let calls = 0;
		await expect(
			startOwnedChat(
				{ workspaceId: f.workspaceId, provider },
				{
					spawn: async () => {
						calls++;
						throw Error("unexpected source checkout launch");
					},
				}
			)
		).rejects.toThrow("prepare this PR workspace");
		expect(calls).toBe(0);
	});
	test(`${provider} own chat uses the prepared isolated PR checkout`, async () => {
		const f = await fixture("worktree");
		const source = directory();
		const ws = getDb().select().from(workspaces).where(eq(workspaces.id, f.workspaceId)).get();
		if (!ws) throw Error("Missing test workspace");
		getDb().update(projects).set({ repoPath: source }).where(eq(projects.id, ws.projectId)).run();
		getDb()
			.update(workspaces)
			.set({ type: "review" })
			.where(eq(workspaces.id, f.workspaceId))
			.run();
		let actualCwd: string | undefined;
		const launch = await startOwnedChat(
			{ workspaceId: f.workspaceId, provider },
			{
				spawn: async (args) => {
					actualCwd = args.cwd;
					return defaultSpawnFn(args);
				},
			}
		);
		expect(actualCwd).toBe(f.cwd);
		expect(launch.cwd).toBe(f.cwd);
		expect(launch.cwd).not.toBe(source);
	});
}
