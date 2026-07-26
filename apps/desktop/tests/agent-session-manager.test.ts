import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getDb } from "../src/main/db";
import { agentSessions, projects, workspaces } from "../src/main/db/schema";
import type {
	AgentForegroundInspection,
	AgentProcessController,
	AgentTerminationResult,
} from "../src/main/services/agent-process-controller";
import {
	AgentSessionManager,
	buildAgentResumeCommand,
} from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import type { AgentEvent } from "../src/shared/agent-events";
import type { AgentSleepSettings } from "../src/shared/agent-session";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

const ENABLED_SETTINGS: AgentSleepSettings = {
	enabled: true,
	idleMinutes: 5,
	keepOrchestratorsAwake: true,
};

function event(
	terminalId: string,
	workspaceId: string,
	alert: AgentEvent["alert"] = "task-complete"
): AgentEvent {
	return {
		sessionId: terminalId,
		terminalId,
		providerSessionId: "provider-session-1",
		workspaceId,
		cwd: "/tmp/worktree",
		alert,
		agent: "claude",
		timestamp: Date.now(),
	};
}

function makeManager(options: {
	settings?: AgentSleepSettings;
	minuteMs?: number;
	terminationResult?: AgentTerminationResult;
	inspectionResult?: AgentForegroundInspection | (() => Promise<AgentForegroundInspection>);
	terminalIds?: string[];
}) {
	const writes: Array<{ id: string; data: string }> = [];
	const terminations: Array<{ terminalId: string; provider: string }> = [];
	const daemon = {
		isConnected: true,
		listSessions: async () =>
			(options.terminalIds ?? ["term-1"]).map((id, index) => ({
				id,
				cwd: "/tmp/worktree",
				pid: 123 + index,
			})),
		write: (id: string, data: string) => writes.push({ id, data }),
	} as unknown as DaemonClient;
	const processController: AgentProcessController = {
		terminateForeground: async (terminalId, provider) => {
			terminations.push({ terminalId, provider });
			return options.terminationResult ?? { ok: true };
		},
		inspectForeground: async () => {
			if (typeof options.inspectionResult === "function") {
				return options.inspectionResult();
			}
			return options.inspectionResult ?? { status: "agent" };
		},
	};
	const manager = new AgentSessionManager({
		daemonClient: daemon,
		processController,
		getSettings: () => options.settings ?? ENABLED_SETTINGS,
		minuteMs: options.minuteMs ?? 10,
	});
	return { manager, writes, terminations };
}

let projectId: string;
let workspaceId: string;
let managers: AgentSessionManager[] = [];

beforeAll(() => {
	setupTestDb();
});

beforeEach(async () => {
	projectId = await seedProject();
	workspaceId = await seedWorkspace(projectId, { name: "agent" });
	managers = [];
});

afterEach(() => {
	for (const manager of managers) manager.dispose();
	getDb().delete(projects).where(eq(projects.id, projectId)).run();
});

describe("buildAgentResumeCommand", () => {
	test("builds provider-specific resume commands", () => {
		expect(
			buildAgentResumeCommand({
				provider: "claude",
				providerSessionId: "claude-id",
				skipPermissions: true,
			})
		).toBe("claude --resume 'claude-id' --dangerously-skip-permissions");
		expect(
			buildAgentResumeCommand({
				provider: "codex",
				providerSessionId: "codex-id",
				skipPermissions: true,
			})
		).toBe("codex resume 'codex-id' -c approval_policy=never -c sandbox_mode=danger-full-access");
		expect(
			buildAgentResumeCommand({
				provider: "gemini",
				providerSessionId: "gemini-id",
				skipPermissions: true,
			})
		).toBe("gemini --resume 'gemini-id' --yolo");
		expect(
			buildAgentResumeCommand(
				{
					provider: "opencode",
					providerSessionId: "open'id",
					skipPermissions: false,
				},
				"continue"
			)
		).toBe("opencode --session 'open'\\''id' --prompt 'continue'");
	});
});

describe("AgentSessionManager", () => {
	test("sleeps a hidden idle agent and wakes it in the preserved shell", async () => {
		const fixture = makeManager({ minuteMs: 1 });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: true,
		});

		fixture.manager.handleAgentEvent(event("term-1", workspaceId));
		await Bun.sleep(15);

		expect(fixture.terminations).toEqual([{ terminalId: "term-1", provider: "claude" }]);
		expect(fixture.manager.getSession("term-1")?.state).toBe("hibernated");

		await fixture.manager.wake("term-1", "next task");
		expect(fixture.writes).toEqual([
			{
				id: "term-1",
				data: "claude --resume 'provider-session-1' --dangerously-skip-permissions 'next task'\r",
			},
		]);
		expect(fixture.manager.getSession("term-1")?.state).toBe("running");
	});

	test("does not auto-sleep a visible terminal, then schedules it when hidden", async () => {
		const fixture = makeManager({ minuteMs: 1 });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});

		await fixture.manager.setVisible("term-1", true);
		fixture.manager.handleAgentEvent(event("term-1", workspaceId));
		await Bun.sleep(10);
		expect(fixture.terminations).toHaveLength(0);

		await fixture.manager.setVisible("term-1", false);
		await Bun.sleep(10);
		expect(fixture.terminations).toHaveLength(1);
	});

	test("needs-input cancels a pending automatic sleep", async () => {
		const fixture = makeManager({ minuteMs: 10 });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});

		fixture.manager.handleAgentEvent(event("term-1", workspaceId));
		await Bun.sleep(5);
		fixture.manager.handleAgentEvent(event("term-1", workspaceId, "needs-input"));
		await Bun.sleep(60);

		expect(fixture.terminations).toHaveLength(0);
		expect(fixture.manager.getSession("term-1")?.state).toBe("needs-input");
	});

	test("keeps orchestrator workspaces awake by default", async () => {
		getDb()
			.update(workspaces)
			.set({ isOrchestrator: true })
			.where(eq(workspaces.id, workspaceId))
			.run();
		const fixture = makeManager({ minuteMs: 1 });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});

		fixture.manager.handleAgentEvent(event("term-1", workspaceId));
		await Bun.sleep(10);

		expect(fixture.terminations).toHaveLength(0);
		expect(fixture.manager.getSession("term-1")?.state).toBe("idle");
	});

	test("wakes a non-Claude workspace when an orchestrator sends follow-up work", async () => {
		const fixture = makeManager({ minuteMs: 1 });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "codex",
			providerSessionId: "codex-session-1",
			skipPermissions: true,
		});
		await fixture.manager.sleepNow("term-1");

		const woke = await fixture.manager.wakeWorkspace(workspaceId, "review the failures");

		expect(woke).toEqual({ status: "woke", terminalId: "term-1" });
		expect(fixture.writes).toEqual([
			{
				id: "term-1",
				data: "codex resume 'codex-session-1' -c approval_policy=never -c sandbox_mode=danger-full-access 'review the failures'\r",
			},
		]);
	});

	test("records a failed automatic sleep without retrying in a tight loop", async () => {
		const fixture = makeManager({
			minuteMs: 1,
			terminationResult: { ok: false, error: "foreground process changed" },
		});
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "codex",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});
		const codexEvent = { ...event("term-1", workspaceId), agent: "codex" };

		fixture.manager.handleAgentEvent(codexEvent);
		await Bun.sleep(15);

		expect(fixture.terminations).toHaveLength(1);
		expect(fixture.manager.getSession("term-1")).toMatchObject({
			state: "idle",
			lastError: "foreground process changed",
		});
	});

	test("keeps exactly one managed dispatch target and ignores newer unmanaged sessions", async () => {
		const fixture = makeManager({
			terminalIds: ["term-1", "term-2"],
		});
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "session-1",
			skipPermissions: false,
		});
		fixture.manager.registerManagedSession({
			terminalId: "term-2",
			workspaceId,
			provider: "codex",
			providerSessionId: "session-2",
			skipPermissions: false,
		});

		expect(fixture.manager.getSession("term-1")?.managed).toBe(false);
		expect(fixture.manager.getSession("term-2")?.managed).toBe(true);

		await fixture.manager.sleepNow("term-2");
		await fixture.manager.sleepNow("term-1");
		const result = await fixture.manager.wakeWorkspace(workspaceId, "continue");

		expect(result).toEqual({ status: "woke", terminalId: "term-2" });
		expect(fixture.writes).toEqual([
			{
				id: "term-2",
				data: "codex resume 'session-2' 'continue'\r",
			},
		]);
	});

	test("fails closed when persisted data has multiple managed targets", async () => {
		const fixture = makeManager({
			terminalIds: ["term-1", "term-2"],
		});
		managers.push(fixture.manager);
		for (const [terminalId, providerSessionId] of [
			["term-1", "session-1"],
			["term-2", "session-2"],
		] as const) {
			fixture.manager.registerManagedSession({
				terminalId,
				workspaceId,
				provider: "claude",
				providerSessionId,
				skipPermissions: false,
			});
			await fixture.manager.sleepNow(terminalId);
		}
		getDb()
			.update(agentSessions)
			.set({ managed: true })
			.where(eq(agentSessions.terminalId, "term-1"))
			.run();

		const result = await fixture.manager.wakeWorkspace(workspaceId, "do not misroute");

		expect(result.status).toBe("ambiguous");
		expect(fixture.writes).toHaveLength(0);
	});

	test("treats a cascaded session as a harmless automatic-sleep no-op", async () => {
		const fixture = makeManager({ minuteMs: 5 });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});
		fixture.manager.handleAgentEvent(event("term-1", workspaceId));

		getDb().delete(workspaces).where(eq(workspaces.id, workspaceId)).run();
		await Bun.sleep(20);

		expect(fixture.terminations).toHaveLength(0);
		expect(fixture.manager.getSession("term-1")).toBeNull();
	});

	test("recovers an interrupted hibernation from the retained shell and wakes it", async () => {
		const fixture = makeManager({ inspectionResult: { status: "shell" } });
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});
		getDb()
			.update(agentSessions)
			.set({ state: "hibernating" })
			.where(eq(agentSessions.terminalId, "term-1"))
			.run();

		await fixture.manager.reconcile();
		expect(fixture.manager.getSession("term-1")?.state).toBe("hibernated");

		await fixture.manager.setVisible("term-1", true);
		expect(fixture.writes).toEqual([
			{
				id: "term-1",
				data: "claude --resume 'provider-session-1'\r",
			},
		]);
	});

	test("does not overwrite a hook event that wins a reconciliation race", async () => {
		let resolveInspection: ((value: AgentForegroundInspection) => void) | undefined;
		const inspection = new Promise<AgentForegroundInspection>((resolve) => {
			resolveInspection = resolve;
		});
		const fixture = makeManager({
			inspectionResult: () => inspection,
		});
		managers.push(fixture.manager);
		fixture.manager.registerManagedSession({
			terminalId: "term-1",
			workspaceId,
			provider: "claude",
			providerSessionId: "provider-session-1",
			skipPermissions: false,
		});
		getDb()
			.update(agentSessions)
			.set({ state: "hibernating" })
			.where(eq(agentSessions.terminalId, "term-1"))
			.run();

		const reconciliation = fixture.manager.reconcile();
		await Bun.sleep(0);
		fixture.manager.handleAgentEvent(event("term-1", workspaceId, "active"));
		resolveInspection?.({ status: "shell" });
		await reconciliation;

		expect(fixture.manager.getSession("term-1")?.state).toBe("running");
	});
});
