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
import { agentSessions, terminalSessions } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import type { AgentEvent } from "../src/shared/agent-events";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
afterEach(() => {
	queuePermissions.close();
	setDaemonClient(null);
});
async function fixture(provider: "claude" | "codex") {
	const projectId = await seedProject();
	const workspaceId = await seedWorkspace(projectId, { name: "Permission fixture" });
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
	return { item: item!, event, replies, manager, terminalId, daemon };
}
for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: admitted exact source request responds without clearing attention`, async () => {
		const f = await fixture(provider);
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
	test(`${provider}: replacement while inventory awaits refuses original decision`, async () => {
		const f = await fixture(provider);
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
}
