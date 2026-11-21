import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import TOML from "@iarna/toml";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { listWorkspaceQueue } from "../../../src/main/activity-queue/workspace-queue";
import { claudeConfig, mergeClaudeHooks } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { startControlPlane } from "../../../src/main/control-plane";
import { setEventsDir } from "../../../src/main/control-plane/orchestrator-event-sink";
import { closeDb, getDb } from "../../../src/main/db";
import {
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	projects,
	terminalSessions,
	workspaces,
	worktrees,
} from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { buildLaunchScript, dispatchAgent } from "../../../src/main/services/workspace-service";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { publicProcedure, router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
import { agentSessionsRouter } from "../../../src/main/trpc/routers/agent-sessions";
import { crossRepoOrchestratorsRouter } from "../../../src/main/trpc/routers/cross-repo-orchestrators";
import { workspacesRouter } from "../../../src/main/trpc/routers/workspaces";
import { agentRegistry } from "../../../src/shared/agent-events";
const required = (key: string) => {
	const value = process.env[key];
	if (!value) throw new Error(`Missing ${key}`);
	return value;
};
const root = required("SS_QUEUE_FIXTURE_ROOT");
const desktop = required("SS_QUEUE_SOURCE_DESKTOP");
const checkedHead = execFileSync("git", ["-C", desktop, "rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim();
const stagingHeadAtLaunch = execFileSync(
	"git",
	["-C", desktop, "rev-parse", "integration/queue-remediation-2026-11-21"],
	{ encoding: "utf8" }
).trim();
const evidence = join(desktop, "../../.hermes/investigations/queue-e2e-postpatch-2026-11-21");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "logs"));
app.disableHardwareAcceleration();
const ptys = new PtyManager();
const socket = new SocketServer(
	ptys,
	{ flush: () => [] } as unknown as ScrollbackStore,
	join(root, "terminal.sock")
);
const daemon = new DaemonClient(
	join(root, "terminal.sock"),
	join(root, "pid"),
	join(root, "daemon.log")
);
const token = randomUUID();
const listener = createAlertListener(0, token);
let win: BrowserWindow | undefined;
let manager: AgentSessionManager | undefined;
let control: Awaited<ReturnType<typeof startControlPlane>> | undefined;
const trace: Record<string, unknown>[] = [];
const results: Record<string, unknown>[] = [];
let step = "startup";
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
async function until(fn: () => boolean | Promise<boolean>) {
	for (let n = 0; n < 2400; n++) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`Timed out at ${step}`);
}
async function run() {
	await app.whenReady();
	mkdirSync(evidence, { recursive: true });
	migrate(getDb(), { migrationsFolder: required("SS_QUEUE_MIGRATIONS") });
	socket.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	manager = new AgentSessionManager({
		daemonClient: daemon,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	setAgentSessionManager(manager);
	agentRegistry.set("claude", claudeConfig);
	agentRegistry.set("codex", codexConfig);
	listener.onEvent((event) => {
		const accepted = manager?.handleAgentEvent(event);
		trace.push({
			provider: event.agent,
			event: event.rawEvent,
			terminal: event.terminalId,
			conversation: event.providerSessionId,
			turn: event.turnId,
			accepted: !!accepted,
			receivedAt: event.timestamp,
			producerTimestamp: event.producerTimestamp,
			evidence: event.evidence,
			permission: event.permission,
			attention: new ActivityQueueService()
				.list()
				.items.filter(
					(i) => i.target.type === "terminal" && i.target.terminalId === event.terminalId
				)
				.map((i) => ({ id: i.id, revision: i.revision, kind: i.kind })),
		});
		if (accepted) win?.webContents.send("agent:alert", accepted);
	});
	await listener.start();
	setEventsDir(join(root, "events"));
	control = await startControlPlane({
		confirm: async () => false,
		spawnFn: async () => {
			throw new Error("External dispatch is disabled in fixture");
		},
	});
	writeFileSync(
		join(root, "control.json"),
		JSON.stringify({ port: control.port, token: control.token }),
		{ mode: 0o600 }
	);
	const bridge = join(root, "bridge.cjs");
	writeFileSync(bridge, HOOK_BRIDGE_SOURCE);
	mergeClaudeHooks(
		join(root, "settings.json"),
		`ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(bridge)}`
	);
	setupTRPCIPC(
		router({
			projects: router({
				list: publicProcedure.query(() => getDb().select().from(projects).all()),
			}),
			crossRepoOrchestrators: crossRepoOrchestratorsRouter,
			activityQueue: activityQueueRouter,
			agentSessions: agentSessionsRouter,
			workspaces: workspacesRouter,
			aiReview: router({ getReviewDrafts: publicProcedure.query(() => []) }),
			prPoller: router({ getCachedPRs: publicProcedure.query(() => []) }),
		})
	);
	win = new BrowserWindow({
		show: false,
		width: 1440,
		height: 900,
		webPreferences: {
			preload: join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	const contents = win.webContents;
	rendererTrust.register(contents.id, pathToFileURL(join(root, "index.html")).href);
	setupTerminalIPC(daemon, manager);
	await win.loadFile(join(root, "index.html"));
	win.show();
	win.focus();
	const js = <T = unknown>(s: string): Promise<T> => contents.executeJavaScript(s);
	const now = new Date();
	const repo = join(root, "repo");
	const folder = join(root, "folder");
	const tree = join(root, "worktree");
	mkdirSync(repo);
	mkdirSync(folder);
	execFileSync("git", ["init", "-q", repo]);
	execFileSync("git", [
		"-C",
		repo,
		"-c",
		"user.name=Queue Fixture",
		"-c",
		"user.email=queue@example.invalid",
		"commit",
		"--allow-empty",
		"-qm",
		"fixture",
	]);
	execFileSync("git", ["-C", repo, "worktree", "add", "-qb", "fixture-work", tree]);
	for (const [id, path, kind] of [
		["repo", repo, "repo"],
		["folder", folder, "folder"],
	] as const)
		getDb()
			.insert(projects)
			.values({
				id,
				name: `Synthetic ${kind}`,
				kind,
				repoPath: path,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	// Real isolated git worktree and folder; production lookup resolves the same roots.
	getDb()
		.insert(worktrees)
		.values({
			id: "tree",
			projectId: "repo",
			path: tree,
			branch: "fixture-work",
			baseBranch: "HEAD",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const selected = process.env["SS_QUEUE_NATIVE_CASES"];
	for (const provider of ["claude", "codex"] as const)
		for (const kind of ["worktree", "folder", "orchestrator", "coordinator"])
			for (const managed of [false, true]) {
				const name = `${provider}-${kind}-${managed ? "dispatch" : "manual"}`;
				if (selected && !name.includes(selected)) continue;
				step = name;
				const id = name;
				const terminal = `terminal-${name}`;
				const sibling = `sibling-${name}`;
				const cwd = kind === "folder" ? folder : kind === "worktree" ? tree : repo;
				const sessionId = provider === "claude" ? randomUUID() : null;
				if (kind === "coordinator") {
					getDb()
						.insert(crossRepoOrchestrators)
						.values({
							id,
							name,
							workDir: cwd,
							agentKind: provider,
							sortOrder: 0,
							createdAt: now,
							updatedAt: now,
						})
						.run();
					for (const projectId of ["repo", "folder"])
						getDb()
							.insert(crossRepoOrchestratorProjects)
							.values({ orchestratorId: id, projectId, sortOrder: 0, createdAt: now })
							.run();
				} else
					getDb()
						.insert(workspaces)
						.values({
							id,
							projectId: kind === "folder" ? "folder" : "repo",
							type: kind === "folder" ? "folder" : kind === "worktree" ? "worktree" : "branch",
							folderPath: kind === "folder" ? folder : null,
							worktreeId: kind === "worktree" ? "tree" : null,
							isOrchestrator: kind === "orchestrator",
							name,
							createdAt: now,
							updatedAt: now,
						})
						.run();
				const bin = join(root, `bin-${name}`);
				mkdirSync(bin);
				const resultPath = join(root, `driver-${name}.json`);
				const mcp = {
					command: process.execPath,
					args: [join(desktop, "mcp-standalone/server.mjs")],
					env: {
						ELECTRON_RUN_AS_NODE: "1",
						SUPERIORSWARM_USER_DATA: root,
						AGENT_NOTIFY_WORKSPACE_ID: id,
						AGENT_NOTIFY_TERMINAL_ID: terminal,
					},
				};
				const config = TOML.parse(readFileSync(join(homedir(), ".codex/config.toml"), "utf8")) as {
					hooks?: { state?: Record<string, Record<string, string | boolean>> };
				};
				const state = Object.fromEntries(
					Object.entries(config.hooks?.state ?? {}).filter(([key]) =>
						key.startsWith(`${join(homedir(), ".codex/hooks.json")}:`)
					)
				);
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
								"-c",
								`hooks=${TOML.stringify.value({ state })}`,
								"--ignore-rules",
								"--skip-git-repo-check",
								"--sandbox",
								"read-only",
								"--json",
							];
				const driverConfig = join(root, `config-${name}.json`);
				writeFileSync(
					driverConfig,
					JSON.stringify({
						provider,
						sessionId,
						command: required(provider === "claude" ? "SS_QUEUE_CLAUDE_BIN" : "SS_QUEUE_CODEX_BIN"),
						base,
						result: resultPath,
					})
				);
				writeFileSync(
					join(bin, provider),
					`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(join(desktop, "tests/fixtures/queue-postpatch-live/driver.cjs"))} ${quote(driverConfig)} "$@"\n`,
					{ mode: 0o755 }
				);
				let output = "";
				for (const tid of [terminal, sibling]) {
					getDb()
						.insert(terminalSessions)
						.values({
							id: tid,
							workspaceId: id,
							cwd,
							title: tid === terminal ? `Actual ${provider} color task` : "Unrelated sibling",
							sortOrder: 0,
							updatedAt: new Date(),
						})
						.run();
					await daemon.create(
						tid,
						cwd,
						(data) => {
							if (tid === terminal) output += data;
						},
						() => {},
						{
							SHELL: "/bin/sh",
							PATH: `${bin}:${process.env["PATH"]}`,
							AGENT_NOTIFY_PORT: String(listener.getPort()),
							AGENT_NOTIFY_TOKEN: token,
							AGENT_NOTIFY_WORKSPACE_ID: id,
							AGENT_NOTIFY_TERMINAL_ID: tid,
							AGENT_NOTIFY_AGENT: provider,
						}
					);
				}
				const prompt =
					provider === "claude"
						? "Isolated synthetic verification. Use ONLY superiorswarm set_status with phase blocked and needs 'Choose amber or blue'. Do not use any other tools or send messages. Ask exactly Which color: amber or blue? Then end your turn."
						: "Do not use any tools. Ask exactly Which color: amber or blue? Then end your turn.";
				const launch = async (content: string) => {
					const script = join(root, `launch-${name}.sh`);
					writeFileSync(script, content);
					daemon.write(terminal, `sh ${quote(script)}\r`);
				};
				if (!managed) assert.equal(manager.getSession(terminal), null);
				if (managed)
					await dispatchAgent(
						{ workspaceId: id, cliPreset: provider, skipPermissions: false, prompt },
						{
							spawnFn: async (args) => {
								manager?.registerManagedSession({
									terminalId: terminal,
									workspaceId: id,
									provider,
									providerSessionId: args.agent?.providerSessionId ?? null,
									skipPermissions: false,
								});
								if (!args.launchScriptContent) throw new Error("Missing production launch script");
								await launch(args.launchScriptContent);
								return { terminalId: terminal, sessionId: terminal };
							},
						}
					);
				else
					await launch(
						buildLaunchScript({
							cwd,
							cliPreset: provider,
							skipPermissions: false,
							cliSessionId: sessionId,
							prompt,
						})
					);
				await until(() => output.includes("NATIVE_LIVE_TURN_1"));
				const first = JSON.parse(readFileSync(resultPath, "utf8"));
				assert.equal(first.code, 0);
				assert.equal(first.question, true);
				assert.equal(manager.getSession(terminal)?.managed, managed);
				const own = async () =>
					(await listWorkspaceQueue()).items.filter((i) => i.context.workspaceId === id);
				await until(async () => (await own()).length > 0);
				const initial = await own();
				assert.equal(initial.length, 1);
				assert.equal(initial[0]?.target.type, "terminal");
				assert.equal(
					initial[0]?.target.type === "terminal" ? initial[0].target.terminalId : null,
					terminal
				);
				if (provider === "claude") {
					assert(initial[0]?.evidence.some((s) => s.includes("Choose amber or blue")));
					assert(
						initial[0]?.providerEvidence?.some((e) =>
							e.text.includes("Which color: amber or blue?")
						)
					);
				}
				await js(
					`window.queueProbe.prepare(${JSON.stringify(id)},${JSON.stringify(cwd)},${JSON.stringify(terminal)},${JSON.stringify(sibling)})`
				);
				await until(() =>
					js<boolean>(
						`document.body.textContent.includes(${JSON.stringify(`Actual ${provider} color task`)})`
					)
				);
				await contents
					.capturePage()
					.then((img) => writeFileSync(join(evidence, `${name}-queue.png`), img.toPNG()));
				if (managed)
					await js(
						`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Open chat'));if(!b)throw new Error('No exact chat Open');b.click()})()`
					);
				else
					await js(
						`window.queueProbe.direct(${JSON.stringify(id)},${JSON.stringify(cwd)},${JSON.stringify(terminal)})`
					);
				await until(() =>
					js<boolean>(
						`window.queueProbe.active().terminal===${JSON.stringify(terminal)}&&!!document.querySelector('textarea')`
					)
				);
				assert.equal((await own()).length, 1);
				await js(`window.electron.terminal.setVisible(${JSON.stringify(terminal)},true)`);
				assert.equal((await own()).length, 1);
				await js("document.querySelector('textarea').focus()");
				await contents.insertText("Blue. Reply exactly COLOR_BLUE_DONE. Do not use tools.");
				await new Promise((r) => setTimeout(r, 100));
				assert.equal((await own()).length, 1);
				contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
				contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
				await until(() => output.includes("NATIVE_LIVE_TURN_2"));
				const second = JSON.parse(readFileSync(resultPath, "utf8"));
				assert.equal(second.code, 0);
				assert.equal(second.followup, true);
				assert.equal(second.session, first.session);
				const events = trace.filter((e) => e["terminal"] === terminal);
				const prompts = events.filter((e) => e["event"] === "UserPromptSubmit");
				assert(prompts.length >= 2);
				assert.deepEqual(prompts.at(-1)?.["attention"], []);
				const after = await own();
				assert.equal(after.length, 1);
				assert(after[0]?.reasons.some((r) => r.code === "turn-ended"));
				assert(!after[0]?.id.startsWith("agent-workspace:"));
				closeDb();
				assert.equal((await own()).length, 1);
				daemon.write(terminal, "__fixture_exit__\r");
				ptys.dispose(terminal);
				assert.equal((await own()).length, 0);
				ptys.dispose(sibling);
				results.push({
					name,
					status: "pass",
					followupRoute: managed ? "queue navigation" : "direct original conversation",
					launch: managed
						? "production dispatchAgent with isolated PTY spawnFn"
						: "production buildLaunchScript in isolated shell",
					cliMode: "real print/exec CLI with readline adapter, not provider TUI",
					bridge:
						provider === "claude" ? "current isolated bridge" : "existing reviewed global bridge",
					first,
					second,
					initialTarget: initial[0]?.target,
					context: initial[0]?.context,
					afterFollowup: after.map((i) => ({
						id: i.id,
						revision: i.revision,
						evidence: i.evidence,
					})),
				});
				writeFileSync(
					join(evidence, "native-live-results.json"),
					JSON.stringify({ checkedHead, stagingHeadAtLaunch, root, results, trace }, null, 2)
				);
			}
	writeFileSync(join(root, "result.json"), JSON.stringify({ passed: true }));
}
async function finish(code: number) {
	writeFileSync(
		join(evidence, "native-live-results.json"),
		JSON.stringify({ checkedHead, stagingHeadAtLaunch, root, step, results, trace }, null, 2)
	);
	listener.stop();
	await control?.stop();
	manager?.dispose();
	setAgentSessionManager(null);
	daemon.disconnect();
	socket.close();
	ptys.disposeAll();
	closeDb();
	win?.destroy();
	app.exit(code);
}
run().then(
	() => finish(0),
	(error) => {
		console.error(step, error);
		void finish(1);
	}
);
