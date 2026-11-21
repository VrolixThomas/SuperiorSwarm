import "./preload-electron-mock";
import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import TOML from "@iarna/toml";
import { eq } from "drizzle-orm";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { listWorkspaceQueue } from "../src/main/activity-queue/workspace-queue";
import { claudeConfig, mergeClaudeHooks } from "../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../src/main/agent-hooks/bridge";
import { createAlertListener } from "../src/main/agent-hooks/listener";
import { startControlPlane } from "../src/main/control-plane";
import { setEventsDir } from "../src/main/control-plane/orchestrator-event-sink";
import { getDb } from "../src/main/db";
import { projects, terminalSessions, workspaces } from "../src/main/db/schema";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { agentRegistry } from "../src/shared/agent-events";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

// Opt-in authenticated CLI probes. Not a production-launch or native SQLite E2E claim.
// No global configuration edits; Claude uses isolated settings, Codex uses existing
// reviewed lifecycle hooks and a unique terminal/token routed to the isolated listener.
test.skipIf(process.env["SS_QUEUE_LIVE"] !== "1")(
	"authenticated provider lifecycle probes (bounded, synthetic content)",
	async () => {
		setupTestDb();
		const root = mkdtempSync(join(tmpdir(), "ss-queue-live-investigation-"));
		const evidence = resolve(
			import.meta.dir,
			"../../../.hermes/investigations/queue-e2e-2026-11-21"
		);
		mkdirSync(evidence, { recursive: true });
		const token = randomUUID();
		const listener = createAlertListener(0, token);
		const manager = new AgentSessionManager({
			daemonClient: {} as DaemonClient,
			processController: {
				inspectForeground: async () => ({ status: "missing" }),
				terminateForeground: async () => ({ ok: true }),
			},
			getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
		});
		const trace: ({ terminal: string; event: string | undefined } & Record<string, unknown>)[] = [];
		const results: unknown[] = [];
		const projectId = await seedProject();
		getDb()
			.update(projects)
			.set({ kind: "folder", repoPath: root })
			.where(eq(projects.id, projectId))
			.run();
		setEventsDir(join(root, "events"));
		const control = await startControlPlane({
			confirm: async () => false,
			spawnFn: async () => {
				throw new Error("Provider probe may not dispatch");
			},
		});
		writeFileSync(
			join(root, "control.json"),
			JSON.stringify({ port: control.port, token: control.token }),
			{ mode: 0o600 }
		);
		agentRegistry.set("claude", claudeConfig);
		agentRegistry.set("codex", codexConfig);
		listener.onEvent((event) => {
			const accepted = manager.handleAgentEvent(event) !== null;
			const attention = new ActivityQueueService()
				.list()
				.items.filter(
					(i) => "workspaceId" in i.target && i.target.workspaceId === event.workspaceId
				)
				.map((i) => ({ sourceId: i.id, kind: i.kind, revision: i.revision }));
			trace.push({
				provider: event.agent,
				event: event.rawEvent,
				terminal: event.terminalId,
				conversation: event.providerSessionId,
				turn: event.turnId ?? null,
				source: event.sessionSource ?? null,
				producedAt: event.producerTimestamp,
				receivedAt: event.timestamp,
				accepted,
				attention,
			});
		});
		await listener.start();
		writeFileSync(join(root, "bridge.cjs"), HOOK_BRIDGE_SOURCE);
		// Retain field names and lifecycle identity only, never prompt/transcript/tool data.
		writeFileSync(
			join(root, "capture.cjs"),
			`const fs=require('node:fs'); const cp=require('node:child_process'); const raw=fs.readFileSync(0,'utf8'); const p=JSON.parse(raw); fs.appendFileSync(${JSON.stringify(join(root, "fields.jsonl"))},JSON.stringify({event:p.hook_event_name,keys:Object.keys(p).sort(),session:p.session_id,turn:p.turn_id??p.prompt_id??null})+'\\n'); const r=cp.spawnSync(process.execPath,[${JSON.stringify(join(root, "bridge.cjs"))}],{input:raw,env:process.env}); process.stdout.write(r.stdout??'');`
		);
		mergeClaudeHooks(
			join(root, "settings.json"),
			[process.execPath, join(root, "capture.cjs")]
				.map((value) => `'${value.replace(/'/g, "'\\''")}'`)
				.join(" ")
		);
		async function run(provider: string, args: string[], env: NodeJS.ProcessEnv) {
			return await new Promise<{ code: number | null; timedOut: boolean; output: string }>(
				(done, reject) => {
					const child = spawn(provider, args, {
						cwd: root,
						env,
						stdio: ["ignore", "pipe", "pipe"],
					});
					let output = "";
					let timedOut = false;
					child.stdout.on("data", (data) => {
						output += String(data);
					});
					child.stderr.on("data", (data) => {
						output += String(data);
					});
					const timer = setTimeout(() => {
						timedOut = true;
						child.kill("SIGTERM");
					}, 45000);
					const killTimer = setTimeout(() => child.kill("SIGKILL"), 48000);
					child.on("error", reject);
					child.on("exit", (code) => {
						clearTimeout(timer);
						clearTimeout(killTimer);
						done({ code, timedOut, output });
					});
				}
			);
		}
		try {
			for (const provider of ["claude", "codex"] as const) {
				const workspaceId = await seedWorkspace(projectId, {
					name: `Live ${provider} synthetic probe`,
				});
				getDb()
					.update(workspaces)
					.set({ type: "folder", folderPath: root })
					.where(eq(workspaces.id, workspaceId))
					.run();
				const terminalId = `live-investigation-${provider}-${randomUUID()}`;
				getDb()
					.insert(terminalSessions)
					.values({
						id: terminalId,
						workspaceId,
						title: `Synthetic ${provider}`,
						cwd: root,
						sortOrder: 0,
						updatedAt: new Date(),
					})
					.run();
				const env = {
					...process.env,
					AGENT_NOTIFY_TOKEN: token,
					AGENT_NOTIFY_PORT: String(listener.getPort()),
					AGENT_NOTIFY_TERMINAL_ID: terminalId,
					AGENT_NOTIFY_WORKSPACE_ID: workspaceId,
					AGENT_NOTIFY_AGENT: provider,
				};
				// Do not inherit the parent investigator's MCP/workspace routing credentials.
				for (const key of Object.keys(env))
					if (/^SUPERIORSWARM_|^CLAUDECODE$|^AGENT_NOTIFY_SESSION_ID$/.test(key))
						delete env[key as keyof typeof env];
				const sessionId = randomUUID();
				const mcp = {
					command: join(
						dirname(require.resolve("electron/package.json")),
						"dist/Electron.app/Contents/MacOS/Electron"
					),
					args: [resolve(import.meta.dir, "../mcp-standalone/server.mjs")],
					env: {
						ELECTRON_RUN_AS_NODE: "1",
						SUPERIORSWARM_USER_DATA: root,
						AGENT_NOTIFY_WORKSPACE_ID: workspaceId,
						AGENT_NOTIFY_TERMINAL_ID: terminalId,
					},
				};
				// Reuse only already persisted user trust for the reviewed global bridge.
				// --ignore-user-config otherwise omits trust as well as unrelated MCP servers.
				const trustArgs: string[] = [];
				if (provider === "codex") {
					const config = TOML.parse(
						readFileSync(join(homedir(), ".codex/config.toml"), "utf8")
					) as { hooks?: { state?: Record<string, Record<string, string | boolean>> } };
					const state = Object.fromEntries(
						Object.entries(config.hooks?.state ?? {}).filter(([key]) =>
							key.startsWith(`${join(homedir(), ".codex/hooks.json")}:`)
						)
					);
					trustArgs.push("-c", `hooks=${TOML.stringify.value({ state })}`);
				}
				const prompt =
					"This is an isolated synthetic queue verification. Use only superiorswarm set_status: report phase blocked with needs 'Choose amber or blue'. Do not send messages, dispatch agents, read or modify files, or use any other tools. Then ask exactly: Which color: amber or blue? End your turn.";
				const base =
					provider === "claude"
						? [
								"-p",
								"--setting-sources",
								"",
								"--settings",
								join(root, "settings.json"),
								"--strict-mcp-config",
								"--mcp-config",
								JSON.stringify({ mcpServers: { superiorswarm: mcp } }),
								"--tools",
								"",
								"--allowedTools",
								"mcp__superiorswarm__set_status",
								"--disable-slash-commands",
								"--output-format",
								"json",
							]
						: [
								"exec",
								"--ignore-user-config",
								...trustArgs,
								"-c",
								`mcp_servers=${TOML.stringify.value({ superiorswarm: mcp })}`,
								"--ignore-rules",
								"--skip-git-repo-check",
								"--sandbox",
								"read-only",
								"--json",
							];
				const first = await run(
					provider,
					[...base, ...(provider === "claude" ? ["--session-id", sessionId] : []), prompt],
					env
				);
				const inventory = {
					isConnected: true,
					async listSessionsStrict() {
						return [{ id: terminalId, cwd: root, pid: 1 }];
					},
				};
				const firstItems = (await listWorkspaceQueue({}, inventory)).items;
				const known = manager.getSession(terminalId);
				const probeOutput = first.output
					.split("\n")
					.flatMap<{ type: string; tool?: string; status?: string; text?: string }>((line) => {
						try {
							const p = JSON.parse(line);
							return p.item
								? [
										{
											type: p.item.type,
											tool: p.item.tool,
											status: p.item.status,
											text: ["agent_message", "error"].includes(p.item.type)
												? (p.item.text ?? p.item.message)
												: undefined,
										},
									]
								: p.type === "result"
									? [{ type: "result", text: p.result }]
									: [];
						} catch {
							return [];
						}
					});
				writeFileSync(
					join(evidence, `live-${provider}-diagnostic.json`),
					JSON.stringify(
						{
							code: first.code,
							probeOutput,
							trace,
							queue: firstItems.map((i) => ({
								id: i.id,
								evidence: i.evidence,
								missingContext: i.missingContext,
								target: i.target,
							})),
						},
						null,
						2
					)
				);
				expect(first.code).toBe(0);
				expect(/Which color: amber or blue\?/.test(first.output)).toBe(true);
				expect(known?.providerSessionId).toBeTruthy();
				const providerReportDelivered = firstItems.some(
					(i) => i.id === `agent-workspace:${workspaceId}`
				);
				if (provider === "claude") expect(providerReportDelivered).toBe(true);
				else if (!providerReportDelivered)
					expect(
						trace.some((e) => e.terminal === terminalId && e.event === "PermissionRequest")
					).toBe(true);
				const summary: Record<string, unknown> = {
					provider,
					firstExit: first.code,
					timedOut: first.timedOut,
					generatedQuestion: /Which color: amber or blue\?/.test(first.output),
					providerMcpStatus: providerReportDelivered
						? "delivered"
						: "permission-blocked-unverified",
					hooks: trace.filter((e) => e.terminal === terminalId),
					queueAfterQuestion: firstItems.map((i) => ({
						kind: i.kind,
						situation: i.situation,
						summary: i.summary,
						target: i.target,
					})),
					sessionTracked: !!known,
				};
				if (known?.providerSessionId && first.code === 0) {
					const secondArgs =
						provider === "claude"
							? [
									...base,
									"--resume",
									known.providerSessionId,
									"Blue. Reply exactly COLOR_BLUE_DONE. Do not use tools.",
								]
							: [
									...base,
									"resume",
									known.providerSessionId,
									"Blue. Reply exactly COLOR_BLUE_DONE. Do not use tools.",
								];
					const second = await run(provider, secondArgs, env);
					expect(second.code).toBe(0);
					expect(second.output.includes("COLOR_BLUE_DONE")).toBe(true);
					expect(
						(await listWorkspaceQueue({}, inventory)).items.some(
							(i) => i.id === `agent-workspace:${workspaceId}`
						)
					).toBe(false);
					summary["followupExit"] = second.code;
					summary["followupTimedOut"] = second.timedOut;
					summary["followupReply"] = second.output.includes("COLOR_BLUE_DONE");
					summary["queueAfterFollowup"] = (await listWorkspaceQueue({}, inventory)).items.map(
						(i) => ({
							id: i.id,
							situation: i.situation,
							target: i.target,
						})
					);
					summary["sources"] = new ActivityQueueService()
						.list()
						.items.filter((i) => "workspaceId" in i.target && i.target.workspaceId === workspaceId)
						.map((i) => ({ kind: i.kind, reasons: i.reasons }));
				}
				// Content-free startup diagnostics: avoid persisting CLI output/config/auth.
				summary["diagnostics"] = {
					rateLimit: /rate.?limit|usage limit/i.test(first.output),
					authError: /unauthorized|authentication.*fail/i.test(first.output),
					routingError: /workspace.*rout|account.*rout|failed to fetch/i.test(first.output),
					hookTrust: /hook.*trust|untrusted.*hook/i.test(first.output),
					outputBytes: first.output.length,
					hookMessages:
						provider === "codex"
							? first.output
									.split("\n")
									.flatMap((line) => {
										try {
											const p = JSON.parse(line);
											return p.item?.type === "error" ? [p.item.message] : [];
										} catch {
											return [];
										}
									})
									.slice(0, 10)
							: [],
				};
				results.push(summary);
				writeFileSync(
					join(evidence, "live-results.json"),
					JSON.stringify({ root, results, trace }, null, 2)
				);
			}
			try {
				writeFileSync(
					join(evidence, "claude-hook-fields.jsonl"),
					readFileSync(join(root, "fields.jsonl"))
				);
			} catch {}
			expect(results).toHaveLength(2);
		} finally {
			manager.dispose();
			listener.stop();
			await control.stop();
		}
	},
	210000
);
