import "./preload-electron-mock";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import { fixProjectHook } from "../src/main/activity-queue/hook-actions";
import { readQueueHookConfig } from "../src/main/activity-queue/hook-config";
import {
	projectHookSourceId,
	refreshProjectHookQueue,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../src/main/activity-queue/hook-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { getDb } from "../src/main/db";
import { aiReviewSettings, projects, terminalSessions, workspaces } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../src/main/services/agent-session-manager-handle";
import {
	type SpawnArgs,
	defaultSpawnFn,
	setDispatchBroadcaster,
} from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
const directories: string[] = [];
let manager: AgentSessionManager | undefined;
afterEach(() => {
	setProjectHooksEnabled(false);
	manager?.dispose();
	setAgentSessionManager(null);
	setDispatchBroadcaster(() => {
		throw Error("No test broadcaster");
	});
	for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
for (const provider of ["claude", "codex"] as const)
	for (const kind of ["repo", "folder", "orchestrator"] as const) {
		test(`${provider} hook Fix in ${kind} prepares a fresh unmanaged chat without replacing the orchestrator`, async () => {
			const root = realpathSync(mkdtempSync(join(tmpdir(), "queue-hook-launch-")));
			directories.push(root);
			const projectId = await seedProject();
			getDb()
				.update(projects)
				.set({ repoPath: root, kind: kind === "folder" ? "folder" : "repo" })
				.where(eq(projects.id, projectId))
				.run();
			const workspaceId = await seedWorkspace(projectId, {
				name: "Hook target",
				type: "branch",
				isOrchestrator: kind === "orchestrator",
			});
			const priorConversation = randomUUID();
			getDb()
				.update(workspaces)
				.set({
					cliSessionId: priorConversation,
					cliPreset: provider,
					...(kind === "folder" ? { type: "folder", folderPath: root } : {}),
				})
				.where(eq(workspaces.id, workspaceId))
				.run();
			getDb()
				.insert(aiReviewSettings)
				.values({ id: "default", cliPreset: provider, skipPermissions: 1 })
				.onConflictDoUpdate({
					target: aiReviewSettings.id,
					set: { cliPreset: provider, skipPermissions: 1 },
				})
				.run();
			mkdirSync(join(root, ".superiorswarm"));
			writeFileSync(
				join(root, ".superiorswarm/queue.yml"),
				'hooks: [{id: check, title: Check, run: "cat output.jsonl"}]'
			);
			const prompt = "Fix the synthetic check; don't run $(touch unsafe).";
			writeFileSync(
				join(root, "output.jsonl"),
				JSON.stringify({
					key: "test",
					title: "Synthetic failing check",
					why: "Fixture failure",
					fixPrompt: prompt,
				})
			);
			setProjectHooksEnabled(true);
			trustProjectHooks(projectId, readQueueHookConfig(root).hash);
			await refreshProjectHookQueue(projectId, true);
			manager = new AgentSessionManager({
				daemonClient: {} as DaemonClient,
				processController: {
					inspectForeground: async () => ({ status: "missing" }),
					terminateForeground: async () => ({ ok: true }),
				},
				getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
			});
			setAgentSessionManager(manager);
			const priorTerminal = randomUUID();
			getDb()
				.insert(terminalSessions)
				.values({
					id: priorTerminal,
					workspaceId,
					title: "Existing managed chat",
					cwd: root,
					sortOrder: 0,
					updatedAt: new Date(),
				})
				.run();
			manager.registerManagedSession({
				terminalId: priorTerminal,
				workspaceId,
				provider,
				providerSessionId: priorConversation,
				skipPermissions: false,
			});
			let broadcasts = 0;
			setDispatchBroadcaster(() => {
				broadcasts++;
			});
			let requested: SpawnArgs | undefined;
			let scriptPath: string | undefined;
			const spawn = async (args: SpawnArgs) => {
				requested = args;
				const result = await defaultSpawnFn(args);
				if (result.launch) {
					scriptPath = result.launch.scriptPath;
					directories.push(dirname(scriptPath));
				}
				return result;
			};
			const queue = new ActivityQueueService();
			const id = projectHookSourceId(projectId, "check", "test");
			const revision = queue.read(id)!.revision;
			const result = await fixProjectHook(
				{ id, revision, workspaceId },
				{ confirm: async () => true, spawn }
			);
			expect(manager.getSession(priorTerminal)?.managed).toBe(true);
			expect(requested?.agent).toMatchObject({
				provider,
				managed: false,
				skipPermissions: false,
				initialPrompt: true,
			});
			expect(requested?.agent?.providerSessionId).not.toBe(priorConversation);
			expect(
				getDb().select().from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.cliSessionId
			).toBe(priorConversation);
			expect(broadcasts).toBe(0);
			expect(result.status).toBe("prepared");
			expect(scriptPath).toBeDefined();
			const script = readFileSync(scriptPath!, "utf8");
			expect(script).toContain(`cd '${root}'`);
			expect(script).toContain(
				provider === "codex" ? "exec codex --no-daemon" : "exec claude --session-id"
			);
			expect(script).toContain("AGENT_NOTIFY_LAUNCH_ID=");
			expect(script).toContain("don't".replace("'", "'\\''"));
			expect(script).not.toContain("dangerously");
			expect(script).not.toContain(priorConversation);
			expect(queue.read(id)?.acknowledgedRevision).not.toBe(revision);
		});
	}
