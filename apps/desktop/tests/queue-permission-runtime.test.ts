import "./preload-electron-mock";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { listWorkspaceQueue } from "../src/main/activity-queue/workspace-queue";
import {
	decideQueuePermission,
	getQueuePermissionCapability,
	queuePermissions,
	resolvePermissionEvent,
} from "../src/main/agent-hooks/permission-runtime";
import { getDb } from "../src/main/db";
import { agentSessions, projects, terminalSessions, workspaces } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import type { AgentEvent } from "../src/shared/agent-events";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
afterEach(() => {
	queuePermissions.close();
	setDaemonClient(null);
});
async function fixture(provider: "claude" | "codex", kind: string) {
	const projectId = await seedProject();
	if (kind === "folder")
		getDb().update(projects).set({ kind: "folder" }).where(eq(projects.id, projectId)).run();
	const workspaceId =
		kind === "coordinator"
			? await seedCrossRepoOrchestrator({ projectIds: [projectId] })
			: await seedWorkspace(projectId, {
					name: "Permission fixture",
					isOrchestrator: kind === "orchestrator",
				});
	if (kind === "folder")
		getDb()
			.update(workspaces)
			.set({ type: "folder", folderPath: "/tmp/permission-fixture" })
			.where(eq(workspaces.id, workspaceId))
			.run();
	const terminalId = randomUUID();
	const providerSessionId = randomUUID();
	getDb()
		.insert(terminalSessions)
		.values({
			id: terminalId,
			workspaceId,
			title: "Fixture",
			cwd: "/tmp",
			sortOrder: 0,
			updatedAt: new Date(),
		})
		.run();
	const daemon = {
		isConnected: true,
		listSessionsStrict: async () => [{ id: terminalId, cwd: "/tmp", pid: 1 }],
	} as unknown as DaemonClient;
	setDaemonClient(daemon);
	const manager = new AgentSessionManager({
		daemonClient: daemon,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	const base: AgentEvent = {
		sessionId: terminalId,
		terminalId,
		providerSessionId,
		workspaceId,
		cwd: "/tmp",
		agent: provider,
		timestamp: Date.now(),
		alert: "active",
		rawEvent: "SessionStart",
		sessionSource: "startup",
	};
	manager.handleAgentEvent(base);
	manager.handleAgentEvent({ ...base, rawEvent: "UserPromptSubmit", turnId: "turn" });
	const event: AgentEvent = {
		...base,
		alert: "needs-input",
		rawEvent: "PermissionRequest",
		turnId: "turn",
		permission: { requestId: randomUUID(), outcome: "pending" },
	};
	expect(manager.handleAgentEvent(event)).not.toBeNull();
	const binding = resolvePermissionEvent(event);
	expect(binding).not.toBeNull();
	const replies: unknown[] = [];
	expect(
		queuePermissions.register({
			...binding!,
			issuedAt: Date.now(),
			allowOnce: true,
			requestId: event.permission!.requestId!,
			summary: "Synthetic operation",
			reply: (v) => {
				replies.push(v);
				return true;
			},
		})
	).toBe(true);
	const items = await listWorkspaceQueue({ view: "pending" });
	const item = items.items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === terminalId
	);
	expect(item).toBeDefined();
	return { item: item!, event, replies, manager, terminalId, daemon, workspaceId };
}
for (const provider of ["claude", "codex"] as const)
	for (const kind of ["worktree", "folder", "orchestrator", "coordinator"]) {
		test(`${provider}/${kind}: admitted exact source request responds without clearing attention`, async () => {
			const f = await fixture(provider, kind);
			expect(getQueuePermissionCapability(f.item).capability).toBe("hook-response");
			expect(f.replies).toHaveLength(0);
			const input = {
				id: f.item.id,
				revision: f.item.revision,
				members: f.item.members,
				requestId: f.event.permission!.requestId!,
				action: "allow-once" as const,
			};
			expect((await decideQueuePermission(input)).status).toBe("sent");
			expect(f.replies).toHaveLength(1);
			expect((await decideQueuePermission(input)).status).toBe("conflict");
			expect((await listWorkspaceQueue()).items.some((i) => i.id === f.item.id)).toBe(true);
			f.manager.dispose();
		});
		test(`${provider}/${kind}: replacement while inventory awaits refuses original decision`, async () => {
			const f = await fixture(provider, kind);
			f.daemon.listSessionsStrict = async () => {
				getDb()
					.update(agentSessions)
					.set({ providerSessionId: "replacement" })
					.where(eq(agentSessions.terminalId, f.terminalId))
					.run();
				return [{ id: f.terminalId, cwd: "/tmp", pid: 1 }] as never;
			};
			expect(
				(
					await decideQueuePermission({
						id: f.item.id,
						revision: f.item.revision,
						requestId: f.event.permission!.requestId!,
						action: "deny",
					})
				).status
			).toBe("conflict");
			expect(f.replies.some((v) => (v as { behavior?: string }).behavior)).toBe(false);
			f.manager.dispose();
		});
		test(`${provider}/${kind}: sibling cannot decide owner; closing owner releases only its wait`, async () => {
			const f = await fixture(provider, kind);
			const sibling = randomUUID();
			const conversation = randomUUID();
			getDb()
				.insert(terminalSessions)
				.values({
					id: sibling,
					workspaceId: f.workspaceId,
					title: "Sibling",
					cwd: "/tmp",
					sortOrder: 1,
					updatedAt: new Date(),
				})
				.run();
			f.daemon.listSessionsStrict = async () =>
				[
					{ id: f.terminalId, cwd: "/tmp", pid: 1 },
					{ id: sibling, cwd: "/tmp", pid: 2 },
				] as never;
			const base = {
				...f.event,
				terminalId: sibling,
				sessionId: sibling,
				providerSessionId: conversation,
				permission: undefined,
				alert: "active" as const,
			};
			f.manager.handleAgentEvent({ ...base, rawEvent: "SessionStart", turnId: undefined });
			f.manager.handleAgentEvent({ ...base, rawEvent: "UserPromptSubmit", turnId: "sibling-turn" });
			const requestId = randomUUID();
			const event = {
				...base,
				rawEvent: "PermissionRequest",
				turnId: "sibling-turn",
				alert: "needs-input" as const,
				permission: { requestId, outcome: "pending" as const },
			};
			f.manager.handleAgentEvent(event);
			const binding = resolvePermissionEvent(event);
			if (!binding) throw Error("Missing sibling binding");
			const replies: unknown[] = [];
			queuePermissions.register({
				...binding,
				requestId,
				issuedAt: Date.now(),
				allowOnce: true,
				summary: "Sibling action",
				reply: (v) => {
					replies.push(v);
					return true;
				},
			});
			const siblingItem = (await listWorkspaceQueue()).items.find(
				(i) => i.target.type === "terminal" && i.target.terminalId === sibling
			);
			if (!siblingItem) throw Error("Missing sibling item");
			expect(
				(
					await decideQueuePermission({
						id: siblingItem.id,
						revision: siblingItem.revision,
						members: siblingItem.members,
						requestId: f.event.permission!.requestId!,
						action: "allow-once",
					})
				).status
			).toBe("conflict");
			expect(f.replies).toEqual([]);
			expect(replies).toEqual([]);
			getDb().delete(terminalSessions).where(eq(terminalSessions.id, f.terminalId)).run();
			await Bun.sleep(300);
			expect(f.replies).toEqual([{ requestId: f.event.permission!.requestId! }]);
			expect(replies).toEqual([]);
			expect(getQueuePermissionCapability(siblingItem).state).toBe("waiting");
			expect((await listWorkspaceQueue()).items.some((i) => i.id === siblingItem.id)).toBe(true);
			f.manager.dispose();
		});
	}
