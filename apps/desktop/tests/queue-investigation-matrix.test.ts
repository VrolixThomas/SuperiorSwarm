import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { questionSourceId, workspaceSourceId } from "../src/main/activity-queue/agent-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { listWorkspaceQueue } from "../src/main/activity-queue/workspace-queue";
import { getDb } from "../src/main/db";
import { projects, terminalSessions, workspaces } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import { sendMessage, setStatus } from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import type { AgentEvent } from "../src/shared/agent-events";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

// Acceptance regressions for the original findings; missing-identity cases stay conservative.
// Every entity is test-owned; Bun's SQLite shim uses /tmp/superiorswarm-test-<pid>.
beforeAll(setupTestDb);
let serial = 0;
async function scenario(provider: "claude" | "codex", kind: string, managed: boolean) {
	const projectId = await seedProject();
	if (kind === "folder")
		getDb().update(projects).set({ kind: "folder" }).where(eq(projects.id, projectId)).run();
	const workspaceId =
		kind === "cross-repo"
			? await seedCrossRepoOrchestrator({
					projectIds: [projectId, await seedProject()],
					agentKind: provider,
				})
			: await seedWorkspace(projectId, {
					name: `Investigation ${kind}`,
					isOrchestrator: kind === "repo-orchestrator",
				});
	if (kind === "folder")
		getDb()
			.update(workspaces)
			.set({ type: "folder", folderPath: "/tmp/isolated-folder" })
			.where(eq(workspaces.id, workspaceId))
			.run();
	const terminalId = `investigation-${++serial}`;
	const sibling = `${terminalId}-sibling`;
	for (const id of [terminalId, sibling])
		getDb()
			.insert(terminalSessions)
			.values({ id, workspaceId, title: id, cwd: "/tmp", sortOrder: 0, updatedAt: new Date() })
			.run();
	const manager = new AgentSessionManager({
		daemonClient: {} as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	if (managed && kind !== "cross-repo")
		manager.registerManagedSession({
			terminalId,
			workspaceId,
			provider,
			providerSessionId: `${terminalId}-conversation`,
			skipPermissions: false,
		});
	let clock = Date.now() + 10;
	function event(rawEvent: string, turnId?: string, id = terminalId): AgentEvent {
		clock = Math.max(clock + 10, Date.now() + 10);
		return {
			terminalId: id,
			sessionId: id,
			workspaceId,
			providerSessionId: `${id}-conversation`,
			agent: provider,
			alert:
				rawEvent === "Stop"
					? "task-complete"
					: rawEvent === "PermissionRequest"
						? "needs-input"
						: "active",
			rawEvent,
			turnId,
			timestamp: clock,
			producerTimestamp: clock,
			sessionSource: rawEvent === "SessionStart" ? "startup" : undefined,
			cwd: "/tmp",
		};
	}
	const inventory = {
		isConnected: true,
		ids: [terminalId, sibling],
		async listSessionsStrict() {
			return this.ids.map((id) => ({ id, cwd: "/tmp", pid: 1 }));
		},
	};
	const ctx = { kind: "workspace" as const, projectId, workspaceId, terminalId };
	const items = async () =>
		(await listWorkspaceQueue({}, inventory)).items.filter(
			(item) =>
				item.target.type !== "unavailable" &&
				"workspaceId" in item.target &&
				item.target.workspaceId === workspaceId
		);
	return { projectId, workspaceId, terminalId, sibling, manager, event, inventory, ctx, items };
}

for (const provider of ["claude", "codex"] as const) {
	for (const managed of [false, true]) {
		for (const kind of ["worktree", "folder", "repo-orchestrator"]) {
			test(`${provider}/${kind}/${managed ? "managed" : "manual"}: exact direct continuation and sibling isolation`, async () => {
				const s = await scenario(provider, kind, managed);
				try {
					expect(s.manager.handleAgentEvent(s.event("SessionStart"))).not.toBeNull();
					s.manager.handleAgentEvent(s.event("UserPromptSubmit", "first"));
					s.manager.handleAgentEvent(s.event("Stop", "first"));
					await setStatus(s.ctx, { phase: "blocked", needs: "Choose amber or blue" });
					expect(await s.items()).toHaveLength(1);
					// Repeated reads are not acknowledgments.
					expect(await s.items()).toHaveLength(1);
					s.manager.handleAgentEvent(s.event("SessionStart", undefined, s.sibling));
					s.manager.handleAgentEvent(s.event("UserPromptSubmit", "sibling-turn", s.sibling));
					expect(await s.items()).toHaveLength(1);
					s.manager.handleAgentEvent(s.event("UserPromptSubmit", "second"));
					expect(await s.items()).toHaveLength(0);
					s.manager.handleAgentEvent(s.event("Stop", "first"));
					expect(await s.items()).toHaveLength(0);
					s.manager.handleAgentEvent(s.event("Stop", "second"));
					expect(await s.items()).toHaveLength(1);
				} finally {
					s.manager.dispose();
				}
			});
		}
		test(`${provider}/cross-repo/${managed ? "managed" : "manual"}: registered coordinator callback is accepted`, async () => {
			const s = await scenario(provider, "cross-repo", managed);
			try {
				if (managed)
					expect(() =>
						s.manager.registerManagedSession({
							terminalId: s.terminalId,
							workspaceId: s.workspaceId,
							provider,
							providerSessionId: "isolated-coordinator",
							skipPermissions: false,
						})
					).not.toThrow();
				expect(s.manager.handleAgentEvent(s.event("SessionStart"))).not.toBeNull();
				expect(s.manager.handleAgentEvent(s.event("Stop", "completed"))).not.toBeNull();
				expect(await s.items()).toHaveLength(1);
			} finally {
				s.manager.dispose();
			}
		});
	}
	test(`${provider}: known reporter is preserved in navigation`, async () => {
		const s = await scenario(provider, "worktree", false);
		try {
			s.manager.handleAgentEvent(s.event("SessionStart"));
			s.manager.handleAgentEvent(s.event("Stop", "first"));
			await setStatus(s.ctx, { phase: "done", statusText: "Synthetic task finished" });
			const report = (await s.items()).find((item) => item.id === workspaceSourceId(s.workspaceId));
			expect(
				(
					new ActivityQueueService().read(report?.id ?? "missing-report")?.snapshot as {
						reporter: { terminalId: string };
					}
				).reporter.terminalId
			).toBe(s.terminalId);
			expect(report?.target).toMatchObject({
				type: "terminal",
				workspaceId: s.workspaceId,
				terminalId: s.terminalId,
				providerSessionId: `${s.terminalId}-conversation`,
			});
			expect(await s.items()).toHaveLength(1);
			// Identity-aware report cleanup does work when the reporting chat closes.
			s.inventory.ids = [s.sibling];
			expect(await s.items()).toHaveLength(0);
		} finally {
			s.manager.dispose();
		}
	});
	test(`${provider}: untagged prompt preserves report and exposes uncertain chat attention`, async () => {
		const s = await scenario(provider, "folder", false);
		try {
			s.manager.handleAgentEvent(s.event("SessionStart"));
			s.manager.handleAgentEvent(s.event("Stop", "before"));
			await setStatus(s.ctx, { phase: "blocked", needs: "Choose amber" });
			expect(s.manager.handleAgentEvent(s.event("UserPromptSubmit"))).not.toBeNull();
			expect((await s.items()).map((item) => item.id)).toContain(workspaceSourceId(s.workspaceId));
			expect(
				(await s.items()).some((item) =>
					item.reasons.some((reason) => reason.code === "callback-order-uncertain")
				)
			).toBe(true);
		} finally {
			s.manager.dispose();
		}
	});
	test(`${provider}: structured question preserves ownership and retires on reporter closure`, async () => {
		const s = await scenario(provider, "worktree", false);
		try {
			s.manager.handleAgentEvent(s.event("SessionStart"));
			const { messageId: id } = await sendMessage(s.ctx, {
				kind: "question",
				content: "Synthetic question: amber or blue?",
			});
			expect((await s.items())[0]?.id).toBe(questionSourceId(id));
			// UI says to answer in the chat, but ordinary accepted chat input has no
			// structured inReplyTo and therefore cannot resolve this question.
			s.manager.handleAgentEvent(s.event("UserPromptSubmit", "answer-in-chat"));
			expect((await s.items())[0]?.id).toBe(questionSourceId(id));
			expect((await s.items())[0]?.target).toMatchObject({
				type: "terminal",
				workspaceId: s.workspaceId,
				terminalId: s.terminalId,
			});
			s.inventory.ids = [s.sibling];
			expect(await s.items()).toHaveLength(0);
		} finally {
			s.manager.dispose();
		}
	});
	test(`${provider}: untagged replay cannot reopen explicitly cleared work`, async () => {
		const s = await scenario(provider, "worktree", false);
		try {
			s.manager.handleAgentEvent(s.event("SessionStart"));
			s.manager.handleAgentEvent(s.event("Stop"));
			// Ensure the actual status timestamp follows the synthetic producer timestamp.
			await Bun.sleep(50);
			await setStatus(s.ctx, { phase: "working" });
			expect(await s.items()).toHaveLength(0);
			// A re-executed old bridge stamps a new wall clock, but no turn identity.
			expect(s.manager.handleAgentEvent(s.event("Stop"))).not.toBeNull();
			expect(await s.items()).toHaveLength(0);
			s.manager.handleAgentEvent(s.event("UserPromptSubmit", "fresh"));
			s.manager.handleAgentEvent(s.event("Stop", "fresh"));
			expect(await s.items()).toHaveLength(1);
		} finally {
			s.manager.dispose();
		}
	});
	test(`${provider}: managed sibling cannot clear a legacy ownerless manual report`, async () => {
		const s = await scenario(provider, "worktree", false);
		try {
			s.manager.handleAgentEvent(s.event("SessionStart"));
			s.manager.registerManagedSession({
				terminalId: s.sibling,
				workspaceId: s.workspaceId,
				provider,
				providerSessionId: `${s.sibling}-conversation`,
				skipPermissions: false,
			});
			// Actual installed MCP uses this ownerless context even with terminal env set.
			await setStatus(
				{ kind: "workspace", projectId: s.projectId, workspaceId: s.workspaceId },
				{ phase: "blocked", needs: "Manual chat needs amber or blue" }
			);
			expect((await s.items()).map((i) => i.id)).toContain(workspaceSourceId(s.workspaceId));
			s.manager.handleAgentEvent(s.event("UserPromptSubmit", "unrelated-managed-work", s.sibling));
			expect((await s.items()).map((i) => i.id)).toContain(workspaceSourceId(s.workspaceId));
		} finally {
			s.manager.dispose();
		}
	});
}
