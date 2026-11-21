import "./preload-electron-mock";
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { eq } from "drizzle-orm";
import { workspaceSourceId } from "../src/main/activity-queue/agent-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { startControlPlane } from "../src/main/control-plane";
import { getDb } from "../src/main/db";
import { projects, terminalSessions, workspaces } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

for (const provider of ["claude", "codex"] as const)
	test(`MCP-before-hook ${provider}: same process admits first registered generation and rejects replacements`, async () => {
		setupTestDb();
		const root = mkdtempSync(join(tmpdir(), "queue-postpatch-bootstrap-"));
		const projectId = await seedProject();
		getDb()
			.update(projects)
			.set({ kind: "folder", repoPath: root })
			.where(eq(projects.id, projectId))
			.run();
		const workspaceId = await seedWorkspace(projectId, { name: "Synthetic cold manual launch" });
		getDb()
			.update(workspaces)
			.set({ type: "folder", folderPath: root })
			.where(eq(workspaces.id, workspaceId))
			.run();
		const terminalId = `cold-${workspaceId}`;
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId,
				title: "Synthetic cold chat",
				cwd: root,
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
		const manager = new AgentSessionManager({
			daemonClient: {} as DaemonClient,
			processController: {
				inspectForeground: async () => ({ status: "missing" }),
				terminateForeground: async () => ({ ok: true }),
			},
			getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		});
		const control = await startControlPlane({
			confirm: async () => false,
			spawnFn: async () => {
				throw new Error("no spawn");
			},
		});
		writeFileSync(
			join(root, "control.json"),
			JSON.stringify({ port: control.port, token: control.token }),
			{ mode: 0o600 }
		);
		const clients: Client[] = [];
		async function connect() {
			const client = new Client({ name: "cold-start-investigator", version: "1" });
			clients.push(client);
			await client.connect(
				new StdioClientTransport({
					command: join(
						dirname(require.resolve("electron/package.json")),
						"dist/Electron.app/Contents/MacOS/Electron"
					),
					args: [resolve(import.meta.dir, "../mcp-standalone/server.mjs")],
					cwd: root,
					env: {
						ELECTRON_RUN_AS_NODE: "1",
						SUPERIORSWARM_USER_DATA: root,
						AGENT_NOTIFY_WORKSPACE_ID: workspaceId,
						AGENT_NOTIFY_TERMINAL_ID: terminalId,
					},
					stderr: "pipe",
				})
			);
			return client;
		}
		const report = () => new ActivityQueueService().read(workspaceSourceId(workspaceId));
		async function event(rawEvent: string, turnId: string, conversation = `session-${terminalId}`) {
			await Bun.sleep(3);
			return manager.handleAgentEvent({
				agent: provider,
				terminalId,
				sessionId: terminalId,
				workspaceId,
				providerSessionId: conversation,
				rawEvent,
				sessionSource: rawEvent === "SessionStart" ? "startup" : undefined,
				turnId,
				alert: "active",
				timestamp: Date.now(),
				producerTimestamp: Date.now(),
				cwd: root,
			});
		}
		const trace: Record<string, unknown>[] = [];
		try {
			expect(manager.getSession(terminalId)).toBeNull();
			const cold = await connect();
			const waiting = await connect();
			const reportPromise = cold.callTool({
				name: "set_status",
				arguments: { phase: "blocked", needs: "Choose amber or blue" },
			});
			await Bun.sleep(30);
			await event("SessionStart", "");
			expect(manager.getSession(terminalId)?.providerSessionId).toBe(`session-${terminalId}`);
			const result = await reportPromise;
			expect(result.isError).not.toBe(true);
			expect(JSON.stringify(result)).toContain("exact-conversation");
			expect(
				(report()?.snapshot as { reporter: { providerSessionId: string } }).reporter
					.providerSessionId
			).toBe(`session-${terminalId}`);
			await event("UserPromptSubmit", "cold-first");
			expect(report()?.candidate).toBeNull();
			trace.push({
				phase: "existing MCP after first hook",
				capability: "exact-conversation",
				directPromptClears: true,
			});
			const fresh = await connect();
			const bound = await fresh.callTool({
				name: "set_status",
				arguments: { phase: "blocked", needs: "Choose amber or blue" },
			});
			expect(JSON.stringify(bound)).toContain("exact-conversation");
			await event("UserPromptSubmit", "fresh-second");
			expect(report()?.candidate).toBeNull();
			trace.push({
				phase: "fresh MCP after hook",
				capability: "exact-conversation",
				directPromptClears: true,
			});
			await event("SessionStart", "", "replacement");
			expect(
				(await waiting.callTool({ name: "set_status", arguments: { phase: "done" } })).isError
			).toBe(true);
			const stale = await fresh.callTool({ name: "set_status", arguments: { phase: "done" } });
			expect(stale.isError).toBe(true);
			expect(JSON.stringify(stale)).toContain("restart MCP");
			trace.push({ phase: "old pinned process after replacement", rejected: true });
			const out = resolve(
				import.meta.dir,
				"../../../.hermes/investigations/queue-e2e-postpatch-2026-11-21"
			);
			mkdirSync(out, { recursive: true });
			writeFileSync(
				join(out, `bootstrap-${provider}.json`),
				JSON.stringify(
					{ provider, realMcp: true, providerEvents: "injected controlled ordering", trace },
					null,
					2
				)
			);
		} finally {
			for (const client of clients) await client.close();
			manager.dispose();
			await control.stop();
		}
	}, 30000);
