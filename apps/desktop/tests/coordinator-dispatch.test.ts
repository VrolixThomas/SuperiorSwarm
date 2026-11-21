import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { startControlPlane } from "../src/main/control-plane";
import { getDb } from "../src/main/db";
import {
	agentSessions,
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import {
	getAgentSessionManager,
	setAgentSessionManager,
} from "../src/main/services/agent-session-manager-handle";
import {
	type AgentDispatchBroadcast,
	dispatchAgent,
	setDispatchBroadcaster,
} from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import {
	seedCrossRepoOrchestrator,
	seedExternalManager,
	seedProject,
	seedWorkspace,
	setupTestDb,
} from "./helpers/db";

beforeAll(setupTestDb);
for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: production coordinator dispatch persists exact managed ownership without a surrogate workspace`, async () => {
		const workDir = mkdtempSync(join(tmpdir(), "coordinator-dispatch-"));
		const coordinator = await seedCrossRepoOrchestrator({ workDir, agentKind: provider });
		const previous = getAgentSessionManager();
		const manager = new AgentSessionManager({
			daemonClient: {} as DaemonClient,
			processController: {
				inspectForeground: async () => ({ status: "missing" }),
				terminateForeground: async () => ({ ok: true }),
			},
			getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		});
		let launch: AgentDispatchBroadcast | undefined;
		setAgentSessionManager(manager);
		setDispatchBroadcaster((value) => {
			launch = value;
		});
		try {
			const result = await dispatchAgent({
				workspaceId: coordinator,
				cliPreset: provider,
				skipPermissions: false,
				prompt: "Return SYNTHETIC_DONE without tools",
			});
			expect(result.status).toBe("started");
			expect(launch?.workspaceId).toBe(coordinator);
			expect(launch?.cwd).toBe(workDir);
			expect(launch?.skipPermissions).toBe(false);
			const stored = getDb()
				.select()
				.from(agentSessions)
				.where(eq(agentSessions.terminalId, result.terminalId))
				.get();
			expect(stored).toMatchObject({
				workspaceId: coordinator,
				entityKind: "coordinator",
				provider,
				managed: true,
				skipPermissions: false,
			});
			if (provider === "claude") expect(stored?.providerSessionId).toBeTruthy();
			expect(
				getDb()
					.select()
					.from(terminalSessions)
					.where(eq(terminalSessions.id, result.terminalId))
					.get()?.workspaceId
			).toBe(coordinator);
			expect(
				getDb().select().from(workspaces).where(eq(workspaces.id, coordinator)).get()
			).toBeUndefined();
			expect(
				getDb()
					.select()
					.from(crossRepoOrchestrators)
					.where(eq(crossRepoOrchestrators.id, coordinator))
					.get()?.status
			).toBe("idle");
		} finally {
			manager.dispose();
			setAgentSessionManager(previous);
			setDispatchBroadcaster(() => {
				throw new Error("No fixture broadcaster");
			});
			if (launch) rmSync(dirname(launch.scriptPath), { recursive: true, force: true });
			rmSync(workDir, { recursive: true, force: true });
		}
	});
}

test("coordinator service rejects project-scoped or external-manager targets before spawn", async () => {
	const project = await seedProject();
	const workspace = await seedWorkspace(project, { name: "Scoped caller" });
	const coordinator = await seedCrossRepoOrchestrator({ projectIds: [project], workDir: "/tmp" });
	const external = await seedExternalManager({ projectIds: [project] });
	let spawned = 0;
	const spawnFn = async () => {
		spawned++;
		return { sessionId: "synthetic", terminalId: "synthetic" };
	};
	await expect(
		dispatchAgent(
			{ projectId: project, workspaceId: coordinator, prompt: "No tools", skipPermissions: false },
			{ spawnFn }
		)
	).rejects.toThrow();
	await expect(
		dispatchAgent(
			{ workspaceId: coordinator, prompt: "No tools", skipPermissions: false },
			{ spawnFn, caller: { kind: "workspace", workspaceId: workspace, projectId: project } }
		)
	).rejects.toThrow();
	await expect(
		dispatchAgent(
			{ workspaceId: external.id, prompt: "No tools", skipPermissions: false },
			{ spawnFn }
		)
	).rejects.toThrow();
	expect(spawned).toBe(0);
});

test("HTTP coordinator dispatch preserves token, linked scope, all-scope and confirmation policy", async () => {
	const own = await seedProject();
	const other = await seedProject();
	const scoped = await seedWorkspace(own, { name: "Project only" });
	const target = await seedCrossRepoOrchestrator({ workDir: "/tmp", projectIds: [own, other] });
	const caller = await seedExternalManager({ projectIds: [own], dispatchPolicy: "auto" });
	let confirmCalls = 0;
	let spawnCalls = 0;
	let confirmAnswer = false;
	const server = await startControlPlane({
		confirm: async () => {
			confirmCalls++;
			return confirmAnswer;
		},
		spawnFn: async (args) => {
			spawnCalls++;
			expect(args.workspaceId).toBe(target);
			expect(args.cwd).toBe("/tmp");
			expect(args.agent?.skipPermissions).toBe(false);
			return { sessionId: "synthetic", terminalId: "synthetic" };
		},
	});
	const request = (headers: Record<string, string>, extra = {}) =>
		fetch(`http://127.0.0.1:${server.port}/workspaces.dispatch`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${server.token}`,
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify({
				workspaceId: target,
				cliPreset: "codex",
				skipPermissions: false,
				prompt: "Return SYNTHETIC_DONE without tools",
				...extra,
			}),
		});
	const auth = { "X-Cross-Repo-Orchestrator-Id": caller.id, "X-Manager-Token": caller.token };
	try {
		expect((await request({ "X-Workspace-Id": scoped })).status).toBe(403);
		expect((await request({ "X-Workspace-Id": scoped }, { projectId: own })).status).toBe(403);
		expect((await request({ ...auth, "X-Manager-Token": "invalid" })).status).toBe(401);
		expect((await request(auth)).status).toBe(403);
		expect(spawnCalls).toBe(0);
		expect(confirmCalls).toBe(0);
		getDb()
			.insert(crossRepoOrchestratorProjects)
			.values({ orchestratorId: caller.id, projectId: other, sortOrder: 1, createdAt: new Date() })
			.run();
		expect((await request(auth)).status).toBe(200);
		expect(spawnCalls).toBe(1);
		expect(confirmCalls).toBe(0);
		getDb()
			.update(crossRepoOrchestrators)
			.set({ accessScope: "all" })
			.where(eq(crossRepoOrchestrators.id, target))
			.run();
		expect((await request(auth)).status).toBe(403);
		getDb()
			.update(crossRepoOrchestrators)
			.set({ accessScope: "all", dispatchPolicy: "confirm" })
			.where(eq(crossRepoOrchestrators.id, caller.id))
			.run();
		expect((await request(auth)).status).toBe(499);
		expect(spawnCalls).toBe(1);
		expect(confirmCalls).toBe(1);
		confirmAnswer = true;
		expect((await request(auth)).status).toBe(200);
		expect(spawnCalls).toBe(2);
		expect(confirmCalls).toBe(2);
	} finally {
		await server.stop();
	}
});

test("coordinator authority is rechecked after confirmation and spawn failure preserves status", async () => {
	const project = await seedProject();
	const target = await seedCrossRepoOrchestrator({ workDir: "/tmp", projectIds: [project] });
	const caller = await seedExternalManager({ projectIds: [project] });
	let spawned = 0;
	const server = await startControlPlane({
		confirm: async () => {
			getDb()
				.delete(crossRepoOrchestratorProjects)
				.where(eq(crossRepoOrchestratorProjects.orchestratorId, caller.id))
				.run();
			return true;
		},
		spawnFn: async () => {
			spawned++;
			return { sessionId: "synthetic", terminalId: "synthetic" };
		},
	});
	try {
		const response = await fetch(`http://127.0.0.1:${server.port}/workspaces.dispatch`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${server.token}`,
				"Content-Type": "application/json",
				"X-Cross-Repo-Orchestrator-Id": caller.id,
				"X-Manager-Token": caller.token,
			},
			body: JSON.stringify({ workspaceId: target, prompt: "No tools", skipPermissions: false }),
		});
		expect(response.status).toBe(403);
		expect(spawned).toBe(0);
		getDb()
			.update(crossRepoOrchestrators)
			.set({ status: "blocked", needs: "Preserve decision" })
			.where(eq(crossRepoOrchestrators.id, target))
			.run();
		await expect(
			dispatchAgent(
				{ workspaceId: target, prompt: "No tools", skipPermissions: false },
				{
					spawnFn: async () => {
						throw new Error("Synthetic spawn failed");
					},
				}
			)
		).rejects.toThrow("Synthetic spawn failed");
		expect(
			getDb()
				.select()
				.from(crossRepoOrchestrators)
				.where(eq(crossRepoOrchestrators.id, target))
				.get()
		).toMatchObject({ status: "blocked", needs: "Preserve decision" });
	} finally {
		await server.stop();
	}
});
