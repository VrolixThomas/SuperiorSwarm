import "./preload-electron-mock";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { claudeConfig } from "../src/main/agent-hooks/agents/claude";
import { HOOK_BRIDGE_SOURCE } from "../src/main/agent-hooks/bridge";
import { createAlertListener } from "../src/main/agent-hooks/listener";
import { getDb } from "../src/main/db";
import { projects } from "../src/main/db/schema";
import {
	type SpawnArgs,
	buildLaunchScript,
	dispatchAgent,
} from "../src/main/services/workspace-service";
import { type AgentEvent, agentRegistry } from "../src/shared/agent-events";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
const dirs: string[] = [];
function temp() {
	const dir = mkdtempSync(join(tmpdir(), "queue-launch-proof-"));
	dirs.push(dir);
	return dir;
}
beforeAll(setupTestDb);
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
test("bridge forwards only a valid per-command environment launch ID; payload cannot forge it", async () => {
	agentRegistry.set("claude", claudeConfig);
	const listener = createAlertListener(0, "launch-test-token");
	await listener.start();
	const events: AgentEvent[] = [];
	listener.onEvent((event) => events.push(event));
	const dir = temp();
	const bridge = join(dir, "bridge.cjs");
	writeFileSync(bridge, HOOK_BRIDGE_SOURCE);
	const id = randomUUID();
	try {
		for (const value of [id.toUpperCase(), "invalid", ""]) {
			const child = Bun.spawn([process.execPath, bridge], {
				stdin: new Response(
					JSON.stringify({
						hook_event_name: "SessionStart",
						session_id: "conversation",
						launchId: randomUUID(),
					})
				),
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					AGENT_NOTIFY_TOKEN: "launch-test-token",
					AGENT_NOTIFY_PORT: String(listener.getPort()),
					AGENT_NOTIFY_AGENT: "claude",
					AGENT_NOTIFY_TERMINAL_ID: "terminal",
					AGENT_NOTIFY_WORKSPACE_ID: "workspace",
					AGENT_NOTIFY_LAUNCH_ID: value,
				},
			});
			expect(await child.exited).toBe(0);
		}
		expect(events.map((e) => e.launchId)).toEqual([id, undefined, undefined]);
		const endpoint = `http://127.0.0.1:${listener.getPort()}/event`;
		await fetch(`${endpoint}?rawEvent=SessionStart&agent=claude&launchId=${id}`, {
			headers: { Authorization: "Bearer launch-test-token" },
		});
		expect(events.at(-1)?.launchId).toBeUndefined();
		await fetch(endpoint, {
			method: "POST",
			headers: { Authorization: "Bearer launch-test-token", "Content-Type": "application/json" },
			body: JSON.stringify({
				rawEvent: "SessionStart",
				agent: "claude",
				launchId: "x".repeat(1000),
			}),
		});
		expect(events.at(-1)?.launchId).toBeUndefined();
	} finally {
		listener.stop();
	}
});
for (const provider of ["claude", "codex"] as const) {
	test(`${provider}: folder and coordinator dispatch bind script to their unique managed launch`, async () => {
		const dir = temp();
		const project = await seedProject();
		getDb()
			.update(projects)
			.set({ kind: "folder", repoPath: dir })
			.where(eq(projects.id, project))
			.run();
		const workspace = await seedWorkspace(project, { name: "Folder launch" });
		const coordinator = await seedCrossRepoOrchestrator({ workDir: dir, projectIds: [project] });
		const calls: SpawnArgs[] = [];
		for (const workspaceId of [workspace, coordinator])
			await dispatchAgent(
				{ workspaceId, cliPreset: provider, prompt: "Probe launch", skipPermissions: false },
				{
					spawnFn: async (args) => {
						calls.push(args);
						return { sessionId: randomUUID(), terminalId: randomUUID() };
					},
				}
			);
		for (const call of calls) {
			const id = call.agent?.queueLaunchId;
			expect(id).toMatch(/^[a-f0-9-]{36}$/);
			expect(call.launchScriptContent).toContain(`AGENT_NOTIFY_LAUNCH_ID='${id}' ${provider}`);
			expect(call.launchScriptContent).not.toContain("export AGENT_NOTIFY_LAUNCH_ID");
		}
		expect(calls[0]?.agent?.queueLaunchId).not.toBe(calls[1]?.agent?.queueLaunchId);
	});
}
test("launch identity cannot become shell syntax", () => {
	expect(() =>
		buildLaunchScript({
			cwd: "/tmp",
			cliPreset: "claude",
			prompt: "Safe",
			skipPermissions: false,
			cliSessionId: null,
			queueLaunchId: "'; unsafe",
		})
	).toThrow("Invalid app launch identity");
});
