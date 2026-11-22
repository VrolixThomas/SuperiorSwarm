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
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
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

test("known app launch cannot lose policy through explicit missing or old daemon metadata", async () => {
	for (const capable of [true, false]) {
		const f = await fixture();
		f.setTarget("legacy");
		f.daemon.supportsQueueResume = capable;
		getDb()
			.update(agentSessions)
			.set({ queueLaunchKnown: true })
			.where(eq(agentSessions.terminalId, f.id))
			.run();
		expect((await f.manager.wake(f.id))?.state).toBe("hibernated");
		await expect(f.manager.beforeTerminalInput(f.id)).rejects.toThrow();
		expect(f.writes).toEqual([]);
	}
});
test("own app chat registration does not steal or demote a managed dispatch target", async () => {
	const f = await fixture();
	const original = f.manager.getSession(f.id);
	if (!original) throw Error("Missing fixture");
	const own = crypto.randomUUID();
	getDb()
		.insert(terminalSessions)
		.values({
			id: own,
			workspaceId: original.workspaceId,
			cwd: "/tmp",
			title: "own",
			sortOrder: 1,
			updatedAt: new Date(),
		})
		.run();
	f.manager.registerOwnedSession({
		terminalId: own,
		workspaceId: original.workspaceId,
		provider: "claude",
		providerSessionId: crypto.randomUUID(),
		skipPermissions: false,
	});
	expect(f.manager.getSession(own)?.managed).toBe(false);
	expect(f.manager.getSession(f.id)?.managed).toBe(true);
});

test("pending app policy binds only after its launchId and is consumed after successful registration", async () => {
	const f = await fixture();
	const row = f.manager.getSession(f.id);
	if (!row) throw Error("Missing owner");
	let registrations = 0;
	Object.assign(f.daemon, {
		queueRegisterLaunch: async () => {
			registrations++;
			return true;
		},
	});
	const launchId = crypto.randomUUID();
	expect(
		await f.manager.registerQueueLaunch(f.id, { provider: "claude", args: [] }, launchId)
	).toBe(false);
	const base = {
		terminalId: f.id,
		sessionId: f.id,
		workspaceId: row.workspaceId,
		agent: "claude",
		providerSessionId: row.providerSessionId!,
		cwd: "/tmp",
		timestamp: Date.now(),
	};
	expect(
		f.manager.handleAgentEvent({
			...base,
			rawEvent: "SessionStart",
			alert: "active",
			launchId: crypto.randomUUID(),
		})
	).not.toBeNull();
	await Promise.resolve();
	expect(registrations).toBe(0);
	expect(
		f.manager.handleAgentEvent({
			...base,
			timestamp: Date.now() + 1,
			rawEvent: "UserPromptSubmit",
			alert: "active",
			turnId: "trusted-turn",
			launchId,
		})
	).not.toBeNull();
	await Promise.resolve();
	expect(registrations).toBe(1);
	f.manager.handleAgentEvent({
		...base,
		timestamp: Date.now() + 2,
		rawEvent: "Stop",
		alert: "task-complete",
		turnId: "trusted-turn",
		launchId,
	});
	await Promise.resolve();
	expect(registrations).toBe(1);
});

test("known launch without an exact clean sleep proof never terminates or changes live state", async () => {
	const f = await fixture();
	let terminated = 0;
	Object.assign(f.daemon, { prepareQueueSleep: async () => null });
	getDb()
		.update(agentSessions)
		.set({ queueLaunchKnown: true, state: "idle", lastError: null })
		.where(eq(agentSessions.terminalId, f.id))
		.run();
	const manager = new AgentSessionManager({
		daemonClient: f.daemon as unknown as DaemonClient,
		processController: {
			async inspectForeground() {
				return { status: "agent" as const };
			},
			async terminateForeground() {
				terminated++;
				return { ok: true };
			},
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	managers.push(manager);
	await expect(manager.sleepNow(f.id)).rejects.toThrow("composer empty");
	expect(terminated).toBe(0);
	expect(manager.getSession(f.id)?.state).toBe("idle");
	expect(f.writes).toEqual([]);
});

test("a callback during sleep preparation prevents terminating the newly active chat", async () => {
	const f = await fixture();
	let killed = 0;
	getDb()
		.update(agentSessions)
		.set({ queueLaunchKnown: true, state: "idle", lastError: null })
		.where(eq(agentSessions.terminalId, f.id))
		.run();
	Object.assign(f.daemon, {
		prepareQueueSleep: async () => {
			getDb()
				.update(agentSessions)
				.set({ state: "running", lastEventAt: new Date(Date.now() + 100) })
				.where(eq(agentSessions.terminalId, f.id))
				.run();
			return "lease";
		},
	});
	const manager = new AgentSessionManager({
		daemonClient: f.daemon as unknown as DaemonClient,
		processController: {
			async inspectForeground() {
				return { status: "agent" as const };
			},
			async terminateForeground() {
				killed++;
				return { ok: true };
			},
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	managers.push(manager);
	await expect(manager.sleepNow(f.id)).rejects.toThrow("changed before sleep");
	expect(killed).toBe(0);
	expect(manager.getSession(f.id)?.state).toBe("running");
});
