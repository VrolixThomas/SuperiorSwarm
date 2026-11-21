import { startControlPlane } from "../src/main/control-plane";
import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
	crossRepoEventsFilePath,
	setEventsDir,
} from "../src/main/control-plane/orchestrator-event-sink";
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
import { type CallerContext, resumeAgent } from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import {
	seedCrossRepoOrchestrator,
	seedExternalManager,
	seedProject,
	seedWorkspace,
	setupTestDb,
} from "./helpers/db";

beforeAll(() => {
	setupTestDb();
	setEventsDir(mkdtempSync(join(tmpdir(), "coordinator-resume-events-")));
});

async function fixture(provider: "claude" | "codex") {
	const project = await seedProject();
	const target = await seedCrossRepoOrchestrator({
		projectIds: [project],
		workDir: "/tmp",
		agentKind: provider,
	});
	const caller = await seedExternalManager({ projectIds: [project] });
	const ctx: CallerContext = {
		kind: "xro",
		xroId: caller.id,
		linkedProjectIds: [project],
		external: true,
		accessScope: "selected",
	};
	const terminal = `${target}-managed`;
	const sibling = `${target}-manual`;
	for (const id of [terminal, sibling])
		getDb()
			.insert(terminalSessions)
			.values({
				id,
				workspaceId: target,
				title: id,
				cwd: "/tmp",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
	const writes: { id: string; data: string }[] = [];
	let inventoryHook: () => void = () => {};
	const manager = new AgentSessionManager({
		daemonClient: {
			isConnected: true,
			listSessions: async () => {
				inventoryHook();
				return [terminal, sibling].map((id) => ({ id, cwd: "/tmp", pid: 1 }));
			},
			write: (id: string, data: string) => {
				writes.push({ id, data });
			},
		} as unknown as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		followUpReadyTimeoutMs: 5,
		followUpPollMs: 1,
	});
	manager.registerManagedSession({
		workspaceId: target,
		terminalId: terminal,
		provider,
		providerSessionId: `conversation-${provider}`,
		skipPermissions: false,
	});
	getDb()
		.update(agentSessions)
		.set({ state: "hibernated" })
		.where(eq(agentSessions.terminalId, terminal))
		.run();
	getDb()
		.insert(agentSessions)
		.values({
			terminalId: sibling,
			workspaceId: target,
			entityKind: "coordinator",
			provider,
			providerSessionId: "unrelated",
			managed: false,
			state: "hibernated",
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.run();
	const previous = getAgentSessionManager();
	setAgentSessionManager(manager);
	return {
		project,
		target,
		caller,
		ctx,
		terminal,
		sibling,
		writes,
		manager,
		setInventoryHook: (hook: () => void) => {
			inventoryHook = hook;
		},
		close: () => {
			manager.dispose();
			setAgentSessionManager(previous);
		},
	};
}
for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: coordinator resume uses its exact managed conversation and own audit log`, async () => {
		const f = await fixture(provider);
		try {
			getDb()
				.update(crossRepoOrchestrators)
				.set({ status: "blocked", needs: "Preserve until accepted prompt" })
				.where(eq(crossRepoOrchestrators.id, f.target))
				.run();
			let fallback = 0;
			const result = await resumeAgent(
				f.ctx,
				{ workspaceId: f.target, message: "Synthetic followup" },
				{
					respawnAgent: async () => {
						fallback++;
					},
				}
			);
			expect(result.ok).toBe(true);
			expect(fallback).toBe(0);
			expect(f.writes).toHaveLength(1);
			expect(f.writes[0]?.id).toBe(f.terminal);
			expect(f.writes[0]?.data).toContain(`conversation-${provider}`);
			expect(f.writes[0]?.data).toContain(provider);
			expect(f.writes[0]?.data).toContain("Synthetic followup");
			expect(f.writes[0]?.data).not.toContain("dangerously");
			expect(f.writes[0]?.data).not.toContain("approval_policy=never");
			expect(readFileSync(crossRepoEventsFilePath(f.target), "utf8")).toContain(result.messageId);
			expect(
				getDb().select().from(workspaces).where(eq(workspaces.id, f.target)).get()
			).toBeUndefined();
			expect(
				getDb()
					.select()
					.from(crossRepoOrchestrators)
					.where(eq(crossRepoOrchestrators.id, f.target))
					.get()?.needs
			).toBe("Preserve until accepted prompt");
		} finally {
			f.close();
		}
	});
	test(`${provider}: missing/ambiguous/replaced coordinator session never falls back or writes to a sibling`, async () => {
		const f = await fixture(provider);
		try {
			let fallback = 0;
			const deps = {
				respawnAgent: async () => {
					fallback++;
				},
			};
			getDb()
				.update(agentSessions)
				.set({ managed: true })
				.where(eq(agentSessions.terminalId, f.sibling))
				.run();
			await expect(
				resumeAgent(f.ctx, { workspaceId: f.target, message: "No fallback" }, deps)
			).rejects.toThrow();
			getDb()
				.update(agentSessions)
				.set({ managed: false })
				.where(eq(agentSessions.terminalId, f.sibling))
				.run();
			f.setInventoryHook(() => {
				getDb()
					.update(agentSessions)
					.set({ providerSessionId: "replacement" })
					.where(eq(agentSessions.terminalId, f.terminal))
					.run();
			});
			await expect(
				resumeAgent(f.ctx, { workspaceId: f.target, message: "No replacement write" }, deps)
			).rejects.toThrow();
			getDb().delete(agentSessions).where(eq(agentSessions.terminalId, f.terminal)).run();
			await expect(
				resumeAgent(f.ctx, { workspaceId: f.target, message: "No sibling write" }, deps)
			).rejects.toThrow();
			expect(fallback).toBe(0);
			expect(f.writes).toHaveLength(0);
		} finally {
			f.close();
		}
	});
	test(`${provider}: coordinator resume denies project-only and revoked authority`, async () => {
		const f = await fixture(provider);
		try {
			const workspace = await seedWorkspace(f.project, {
				name: "Project orchestrator",
				isOrchestrator: true,
			});
			await expect(
				resumeAgent(
					{ kind: "workspace", workspaceId: workspace, projectId: f.project },
					{ workspaceId: f.target, message: "No escalation" }
				)
			).rejects.toThrow();
			f.setInventoryHook(() => {
				getDb()
					.delete(crossRepoOrchestratorProjects)
					.where(eq(crossRepoOrchestratorProjects.orchestratorId, f.caller.id))
					.run();
			});
			await expect(
				resumeAgent(f.ctx, { workspaceId: f.target, message: "Revoked before delivery" })
			).rejects.toThrow();
			expect(f.writes).toHaveLength(0);
		} finally {
			f.close();
		}
	});
}

for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: authenticated resume_agent HTTP reaches the exact managed coordinator`, async () => {
		const f = await fixture(provider);
		const server = await startControlPlane({
			confirm: async () => false,
			spawnFn: async () => {
				throw new Error("Resume must not dispatch a replacement");
			},
		});
		try {
			const result = await fetch(`http://127.0.0.1:${server.port}/workspaces.resume_agent`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${server.token}`,
					"X-Cross-Repo-Orchestrator-Id": f.caller.id,
					"X-Manager-Token": f.caller.token,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ workspaceId: f.target, message: "Synthetic HTTP followup" }),
			});
			expect(result.status).toBe(200);
			expect((await result.json()).ok).toBe(true);
			expect(f.writes).toHaveLength(1);
			expect(f.writes[0]?.id).toBe(f.terminal);
			expect(f.writes[0]?.data).toContain(`conversation-${provider}`);
		} finally {
			await server.stop();
			f.close();
		}
	});
}
