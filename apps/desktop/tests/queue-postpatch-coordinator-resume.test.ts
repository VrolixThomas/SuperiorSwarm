import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { listWorkspaceQueue } from "../src/main/activity-queue/workspace-queue";
import { setEventsDir } from "../src/main/control-plane/orchestrator-event-sink";
import { getDb } from "../src/main/db";
import { agentSessions, terminalSessions } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../src/main/services/agent-session-manager-handle";
import { resumeAgent, setStatus } from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { seedCrossRepoOrchestrator, seedProject, setupTestDb } from "./helpers/db";

beforeAll(() => {
	setupTestDb();
	setEventsDir(mkdtempSync(join(tmpdir(), "postpatch-resume-events-")));
});
for (const provider of ["claude", "codex"] as const)
	test(`production resumeAgent ${provider}: authorized coordinator uses exact managed session; partial scope cannot act`, async () => {
		const projects = [await seedProject(), await seedProject()];
		const target = await seedCrossRepoOrchestrator({ projectIds: projects });
		const caller = await seedCrossRepoOrchestrator({ projectIds: projects });
		const partialCaller = await seedCrossRepoOrchestrator({ projectIds: projects.slice(0, 1) });
		const terminal = `resume-owner-${target}`;
		const sibling = `resume-sibling-${target}`;
		const writes: { id: string; command: string }[] = [];
		let fallback = 0;
		const daemon = {
			isConnected: true,
			async listSessions() {
				return [terminal, sibling].map((id) => ({ id, cwd: "/tmp", pid: 1 }));
			},
			async listSessionsStrict() {
				return this.listSessions();
			},
			write(id: string, command: string) {
				writes.push({ id, command });
			},
		};
		const manager = new AgentSessionManager({
			daemonClient: daemon as unknown as DaemonClient,
			processController: {
				inspectForeground: async () => ({ status: "missing" }),
				terminateForeground: async () => ({ ok: true }),
			},
			getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		});
		setAgentSessionManager(manager);
		try {
			for (const id of [sibling, terminal]) {
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
				manager.registerManagedSession({
					terminalId: id,
					workspaceId: target,
					provider: id === terminal ? provider : provider === "claude" ? "codex" : "claude",
					providerSessionId: `exact-${id}`,
					skipPermissions: false,
				});
				getDb()
					.update(agentSessions)
					.set({ state: "hibernated" })
					.where(eq(agentSessions.terminalId, id))
					.run();
			}
			await setStatus(
				{ kind: "xro", xroId: target, linkedProjectIds: projects, terminalId: terminal },
				{ phase: "done", statusText: "Synthetic prior task finished" }
			);
			const pending = (await listWorkspaceQueue({}, daemon)).items.find(
				(i) => i.context.workspaceId === target
			);
			expect(pending).toBeDefined();
			const deps = {
				respawnAgent: async () => {
					fallback++;
					throw new Error("No legacy fallback allowed");
				},
			};
			await expect(
				resumeAgent(
					{ kind: "xro", xroId: partialCaller, linkedProjectIds: projects.slice(0, 1) },
					{ workspaceId: target, message: "Synthetic follow-up" },
					deps
				)
			).rejects.toThrow(/forbidden|not linked|scope/i);
			expect(writes).toHaveLength(0);
			expect(fallback).toBe(0);
			const result = await resumeAgent(
				{ kind: "xro", xroId: caller, linkedProjectIds: projects },
				{ workspaceId: target, message: "Synthetic follow-up" },
				deps
			);
			expect(result.ok).toBe(true);
			expect(writes).toHaveLength(1);
			expect(writes[0]?.id).toBe(terminal);
			expect(writes[0]?.command).toContain(
				provider === "claude" ? "claude --resume" : "codex resume"
			);
			expect(writes[0]?.command).toContain(`exact-${terminal}`);
			expect(writes[0]?.command).not.toContain("danger");
			expect(fallback).toBe(0);
			expect((await listWorkspaceQueue({}, daemon)).items.some((i) => i.id === pending?.id)).toBe(
				true
			);
		} finally {
			manager.dispose();
			setAgentSessionManager(null);
		}
	});
