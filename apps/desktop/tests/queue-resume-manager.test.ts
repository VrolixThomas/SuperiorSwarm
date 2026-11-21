import "./preload-electron-mock";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { agentSessions, terminalSessions } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
beforeAll(setupTestDb);
const managers: AgentSessionManager[] = [];
afterEach(() => {
	for (const manager of managers) manager.dispose();
	managers.length = 0;
});
async function fixture() {
	const workspaceId = await seedWorkspace(await seedProject(), { name: "guarded resume" });
	const id = crypto.randomUUID();
	const conversation = crypto.randomUUID();
	getDb()
		.insert(terminalSessions)
		.values({ id, workspaceId, cwd: "/tmp", title: "chat", sortOrder: 0, updatedAt: new Date() })
		.run();
	const writes: string[] = [];
	let target: "unknown" | "rejected" | "ready" | "legacy" = "unknown";
	let delivery: "admitted" | "rejected" | "uncertain" = "admitted";
	const daemon = {
		isConnected: true,
		supportsQueueResume: true,
		async listSessions() {
			return [{ id, cwd: "/tmp", pid: 1 }];
		},
		write(_id: string, data: string) {
			writes.push(data);
		},
		async queueResumeTarget() {
			if (target === "unknown") throw Error("No response");
			return target === "legacy"
				? null
				: { generation: "guard", supported: target === "ready", foreground: "sh" };
		},
		async resumeQueueView() {
			if (delivery === "admitted")
				getDb()
					.update(agentSessions)
					.set({ state: "resuming" })
					.where(eq(agentSessions.terminalId, id))
					.run();
			return delivery;
		},
	};
	const manager = new AgentSessionManager({
		daemonClient: daemon as unknown as DaemonClient,
		processController: {
			async inspectForeground() {
				return { status: "shell" as const };
			},
			async terminateForeground() {
				return { ok: true };
			},
		},
		getSettings: () => ({ enabled: false, idleMinutes: 1, keepOrchestratorsAwake: true }),
	});
	managers.push(manager);
	manager.registerManagedSession({
		terminalId: id,
		workspaceId,
		provider: "claude",
		providerSessionId: conversation,
		skipPermissions: false,
	});
	getDb()
		.update(agentSessions)
		.set({ state: "hibernated", hibernatedAt: new Date() })
		.where(eq(agentSessions.terminalId, id))
		.run();
	return {
		manager,
		id,
		writes,
		daemon,
		setTarget: (value: typeof target) => {
			target = value;
		},
		setDelivery: (value: typeof delivery) => {
			delivery = value;
		},
	};
}
test("unknown and rejected structured wake never downgrade to shell commands or flush user input", async () => {
	for (const target of ["unknown", "rejected"] as const) {
		const f = await fixture();
		f.setTarget(target);
		expect((await f.manager.wake(f.id))?.state).toBe("hibernated");
		await expect(
			(async () => {
				await f.manager.beforeTerminalInput(f.id);
				f.daemon.write(f.id, "user text\r");
			})()
		).rejects.toThrow();
		expect(f.writes).toEqual([]);
	}
});
test("uncertain structured wake blocks buffered input; admitted view wake preserves same terminal", async () => {
	const f = await fixture();
	f.setTarget("ready");
	f.setDelivery("uncertain");
	await expect(f.manager.beforeTerminalInput(f.id)).rejects.toThrow();
	expect(f.writes).toEqual([]);
	f.setDelivery("admitted");
	expect((await f.manager.wake(f.id))?.state).toBe("resuming");
	expect(f.writes).toEqual([]);
});
test("showing ordinary shell or idle live chat is not treated as a failed sleeping resume", async () => {
	const f = await fixture();
	await f.manager.setVisible("ordinary-unmanaged-shell", true);
	getDb()
		.update(agentSessions)
		.set({ state: "idle", lastError: null })
		.where(eq(agentSessions.terminalId, f.id))
		.run();
	await f.manager.setVisible(f.id, true);
	expect(f.writes).toEqual([]);
});
test("legacy fallback requires explicit absence of descriptor, never transport ambiguity", async () => {
	const f = await fixture();
	f.setTarget("legacy");
	expect((await f.manager.wake(f.id))?.state).toBe("running");
	expect(f.writes).toHaveLength(1);
});
