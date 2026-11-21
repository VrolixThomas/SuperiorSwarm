import "./preload-electron-mock";
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { eq } from "drizzle-orm";
import {
	observeValidatedAgentEvent,
	sessionSourceId,
	workspaceSourceId,
} from "../src/main/activity-queue/agent-source";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { listWorkspaceQueue, workspaceAnswer } from "../src/main/activity-queue/workspace-queue";
import { startControlPlane } from "../src/main/control-plane";
import { setEventsDir } from "../src/main/control-plane/orchestrator-event-sink";
import { getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	crossRepoOrchestrators,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

// Actual stdio MCP child processes -> production HTTP server -> isolated SQLite shim.
// No provider model execution in this test. Installed MCP comparison is opt-in.
test.skipIf(process.platform !== "darwin")(
	"MCP current/legacy/missing identity and cross-repo linked folder reports",
	async () => {
		setupTestDb();
		const root = mkdtempSync(join(tmpdir(), "ss-queue-mcp-investigation-"));
		setEventsDir(join(root, "events"));
		const server = await startControlPlane({
			confirm: async () => false,
			spawnFn: async () => {
				throw new Error("No dispatch authorized in MCP identity probe");
			},
		});
		writeFileSync(
			join(root, "control.json"),
			JSON.stringify({ port: server.port, token: server.token }),
			{ mode: 0o600 }
		);
		const evidence: unknown[] = [];
		const electron = join(
			dirname(require.resolve("electron/package.json")),
			"dist/Electron.app/Contents/MacOS/Electron"
		);
		const current = resolve(import.meta.dir, "../mcp-standalone/server.mjs");
		const installed =
			"/Applications/SuperiorSwarm.app/Contents/Resources/app.asar.unpacked/mcp-standalone/server.mjs";
		try {
			for (const mode of [
				"current",
				"missing-identity",
				...(process.env["SS_QUEUE_INSTALLED_MCP"] === "1" && existsSync(installed)
					? ["installed"]
					: []),
			]) {
				for (const provider of ["claude", "codex"] as const) {
					const folder = join(root, `${mode}-${provider}`);
					mkdirSync(folder);
					const projectId = await seedProject();
					getDb()
						.update(projects)
						.set({ kind: "folder", repoPath: folder })
						.where(eq(projects.id, projectId))
						.run();
					const workspaceId = await seedWorkspace(projectId, {
						name: `Synthetic ${mode} ${provider}`,
					});
					getDb()
						.update(workspaces)
						.set({ type: "folder", folderPath: folder })
						.where(eq(workspaces.id, workspaceId))
						.run();
					const terminalId = `terminal-${workspaceId}`;
					getDb()
						.insert(terminalSessions)
						.values({
							id: terminalId,
							workspaceId,
							cwd: folder,
							title: "Synthetic reporter",
							sortOrder: 0,
							updatedAt: new Date(),
						})
						.run();
					getDb()
						.insert(agentSessions)
						.values({
							terminalId,
							workspaceId,
							provider,
							providerSessionId: `conversation-${terminalId}`,
							state: "idle",
							managed: false,
							createdAt: new Date(),
							updatedAt: new Date(),
						})
						.run();
					const client = new Client({ name: "isolated-queue-investigator", version: "1" });
					const transport = new StdioClientTransport({
						command: electron,
						args: [mode === "installed" ? installed : current],
						cwd: folder,
						env: {
							ELECTRON_RUN_AS_NODE: "1",
							SUPERIORSWARM_USER_DATA: root,
							AGENT_NOTIFY_WORKSPACE_ID: workspaceId,
							...(mode === "missing-identity" ? {} : { AGENT_NOTIFY_TERMINAL_ID: terminalId }),
						},
						stderr: "pipe",
					});
					try {
						await client.connect(transport);
						const result = await client.callTool({
							name: "set_status",
							arguments: { phase: "blocked", needs: "Synthetic: choose amber or blue" },
						});
						expect(result.isError).not.toBe(true);
						const source = new ActivityQueueService().read(workspaceSourceId(workspaceId));
						const reporter = (source?.snapshot as { reporter?: { terminalId: string } })?.reporter;
						expect(reporter?.terminalId ?? null).toBe(mode === "current" ? terminalId : null);
						evidence.push({
							mode,
							provider,
							terminalId,
							reporter: reporter ?? null,
							source: source?.sourceId,
							revision: source?.revision,
						});
						const completedAt = Date.now();
						const callback = {
							terminalId,
							sessionId: terminalId,
							workspaceId,
							providerSessionId: `conversation-${terminalId}`,
							agent: provider,
							alert: "task-complete" as const,
							rawEvent: "Stop",
							turnId: "before-mcp-working",
							timestamp: completedAt,
							producerTimestamp: completedAt,
							cwd: folder,
						};
						expect(observeValidatedAgentEvent(callback)).toBe(true);
						await Bun.sleep(5);
						await client.callTool({ name: "set_status", arguments: { phase: "working" } });
						const sessionId = sessionSourceId(
							workspaceId,
							terminalId,
							provider,
							callback.providerSessionId
						);
						expect(new ActivityQueueService().read(sessionId)?.candidate === null).toBe(
							mode === "current"
						);
						if (mode === "current")
							expect(
								observeValidatedAgentEvent({
									...callback,
									timestamp: Date.now(),
									producerTimestamp: Date.now(),
								})
							).toBe(false);
						evidence.push({
							mode,
							provider,
							missingPromptHook: true,
							workingClearedChat: new ActivityQueueService().read(sessionId)?.candidate === null,
						});
						if (mode === "current") {
							const asked = await client.callTool({
								name: "send_message",
								arguments: { kind: "question", content: "Synthetic exact inbox decision" },
							});
							expect(asked.isError).not.toBe(true);
							const inventory = {
								isConnected: true,
								async listSessionsStrict() {
									return [{ id: terminalId, cwd: folder, pid: 1 }];
								},
							};
							const question = (await listWorkspaceQueue({}, inventory)).items.find(
								(row) => row.context.workspaceId === workspaceId && row.question
							);
							if (!question?.question) throw new Error("MCP question missing exact owner");
							const reply = await workspaceAnswer(
								{
									id: question.id,
									revision: question.revision,
									questionId: question.question.messageId,
									content: "Synthetic answer",
								},
								inventory
							);
							expect(reply.status).toBe("saved");
							const unpinned = await fetch(
								`http://127.0.0.1:${server.port}/workspaces.read_messages?includeBroadcasts=false`,
								{
									headers: {
										Authorization: `Bearer ${server.token}`,
										"X-Workspace-Id": workspaceId,
										"X-Terminal-Id": terminalId,
									},
								}
							);
							expect((await unpinned.json()).messages).toEqual([]);
							const fetched = await fetch(
								`http://127.0.0.1:${server.port}/workspaces.read_messages?includeBroadcasts=false`,
								{
									headers: {
										Authorization: `Bearer ${server.token}`,
										"X-Workspace-Id": workspaceId,
										"X-Terminal-Id": terminalId,
										"X-Queue-Reporter": JSON.stringify(question.target),
									},
								}
							);
							expect(fetched.ok).toBe(true);
							expect((await fetched.json()).messages).toHaveLength(1);
							// Simulate lost/aborted handoff: no transport receipt means still pending.
							expect(
								getDb()
									.select()
									.from(agentMessages)
									.where(eq(agentMessages.inReplyTo, question.question.messageId))
									.get()?.retrievedAt
							).toBeNull();

							const read = await client.callTool({
								name: "read_messages",
								arguments: { include_broadcasts: false },
							});
							expect(read.isError).not.toBe(true);
							expect(
								getDb()
									.select()
									.from(agentMessages)
									.where(eq(agentMessages.inReplyTo, question.question.messageId))
									.get()?.retrievedAt
							).toBeTruthy();
							getDb()
								.update(agentSessions)
								.set({ providerSessionId: "replacement-generation" })
								.where(eq(agentSessions.terminalId, terminalId))
								.run();
							const stale = await client.callTool({
								name: "set_status",
								arguments: { phase: "done", status_text: "Must not replace reporter" },
							});
							expect(stale.isError).toBe(true);
							expect(JSON.stringify(stale)).toContain("conversation changed");
						}
					} finally {
						await client.close();
					}
				}
			}
			const repoId = await seedProject();
			const folderId = await seedProject();
			getDb()
				.update(projects)
				.set({ kind: "folder", repoPath: root })
				.where(eq(projects.id, folderId))
				.run();
			const xroId = await seedCrossRepoOrchestrator({
				workDir: root,
				projectIds: [repoId, folderId],
			});
			getDb()
				.insert(terminalSessions)
				.values({
					id: "synthetic-xro-terminal",
					workspaceId: xroId,
					title: "Coordinator",
					cwd: root,
					sortOrder: 0,
					updatedAt: new Date(),
				})
				.run();
			getDb()
				.insert(agentSessions)
				.values({
					terminalId: "synthetic-xro-terminal",
					workspaceId: xroId,
					entityKind: "coordinator",
					provider: "claude",
					providerSessionId: "coordinator-conversation",
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.run();
			const client = new Client({ name: "isolated-coordinator-investigator", version: "1" });
			const transport = new StdioClientTransport({
				command: electron,
				args: [current],
				cwd: root,
				env: {
					ELECTRON_RUN_AS_NODE: "1",
					SUPERIORSWARM_USER_DATA: root,
					AGENT_NOTIFY_WORKSPACE_ID: xroId,
					AGENT_NOTIFY_TERMINAL_ID: "synthetic-xro-terminal",
				},
				stderr: "pipe",
			});
			try {
				await client.connect(transport);
				const result = await client.callTool({
					name: "set_status",
					arguments: {
						phase: "blocked",
						needs: "Synthetic cross-repo decision",
						status_text: "Synthetic linked repo and folder",
					},
				});
				expect(result.isError).not.toBe(true);
				expect(
					getDb()
						.select()
						.from(crossRepoOrchestrators)
						.where(eq(crossRepoOrchestrators.id, xroId))
						.get()?.status
				).toBe("blocked");
				const queue = await listWorkspaceQueue(
					{},
					{
						isConnected: true,
						async listSessionsStrict() {
							return [{ id: "synthetic-xro-terminal", cwd: root, pid: 1 }];
						},
					}
				);
				expect(queue.items).toHaveLength(1);
				expect(queue.items[0]?.target).toMatchObject({
					type: "terminal",
					entity: { kind: "coordinator", id: xroId },
					terminalId: "synthetic-xro-terminal",
					providerSessionId: "coordinator-conversation",
				});
				expect(queue.items[0]?.summary).toBe("Synthetic cross-repo decision");
				expect(
					getDb()
						.select()
						.from(crossRepoOrchestrators)
						.where(eq(crossRepoOrchestrators.id, xroId))
						.get()?.statusText
				).toBe("Synthetic linked repo and folder");
				evidence.push({
					mode: "cross-repo",
					linkedKinds: ["repo", "folder"],
					setStatusAccepted: true,
					persistedStatus: "blocked",
					queueItems: queue.items.length,
				});
			} finally {
				await client.close();
			}
			const out = resolve(
				import.meta.dir,
				process.env["SS_QUEUE_MCP_EVIDENCE_DIR"] ??
					"../../../.hermes/verification/queue-ownership-2026-11-21"
			);
			mkdirSync(out, { recursive: true });
			writeFileSync(join(out, "mcp-processes.json"), JSON.stringify(evidence, null, 2));
		} finally {
			await server.stop();
		}
	},
	45000
);
