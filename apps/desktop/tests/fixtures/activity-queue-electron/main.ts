import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app, session } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { listCurrentActivityQueue } from "../../../src/main/activity-queue/current-items";
import { observePRActivity, prSourceId } from "../../../src/main/activity-queue/pr-source";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { claudeConfig } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { closeDb, getDb } from "../../../src/main/db";
import { agentSessions, projects, terminalSessions, workspaces } from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { setStatus } from "../../../src/main/services/workspace-service";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
import { agentSessionsRouter } from "../../../src/main/trpc/routers/agent-sessions";
import { workspacesRouter } from "../../../src/main/trpc/routers/workspaces";
import { agentRegistry } from "../../../src/shared/agent-events";
import type { CachedPR } from "../../../src/shared/review-types";
import { terminalCreateErrorCode } from "../../../src/shared/terminal-create";

const root = requireEnvironment("SS_QUEUE_FIXTURE_ROOT");
function requireEnvironment(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`Missing isolated fixture setting: ${key}`);
	return value;
}
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
const listener = createAlertListener(0, "fixture-only-token");
let win: BrowserWindow | undefined;
let manager: AgentSessionManager | undefined;
const ptys = new PtyManager();
const socketPath = join(root, "terminal.sock");
const socketServer = new SocketServer(
	ptys,
	{ flush: () => [] } as unknown as ScrollbackStore,
	socketPath
);
const daemon = new DaemonClient(socketPath, join(root, "pid"), join(root, "daemon.log"));
let createdPtys = 0;
let terminalOutput = "";
let disappearOnAttach = false;
const createPty = ptys.create.bind(ptys);
ptys.create = (...args) => {
	createdPtys++;
	return createPty(...args);
};
const attachPty = ptys.attach.bind(ptys);
ptys.attach = (...args) => {
	if (disappearOnAttach && args[0] === "terminal") ptys.dispose(args[0]);
	return attachPty(...args);
};
let step = "startup";
const until = async (condition: () => boolean | Promise<boolean>) => {
	for (let i = 0; i < 200; i++) {
		if (await condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	console.error(
		"QUEUE_STATE",
		JSON.stringify(
			(await listCurrentActivityQueue()).items.map((item) => ({
				id: item.id,
				kind: item.kind,
				revision: item.revision,
			}))
		)
	);
	console.error("AGENT_STATE", JSON.stringify(manager?.getSession("terminal")));
	throw new Error(`Timed out: ${step}`);
};
async function run() {
	await app.whenReady();
	mkdirSync(join(root, "bin"));
	socketServer.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	await daemon.create(
		"terminal",
		root,
		(data) => {
			terminalOutput += data;
		},
		() => {},
		{ SHELL: "/bin/sh", HOME: root, PATH: `${join(root, "bin")}:/usr/bin:/bin` }
	);
	await daemon.listSessionsStrict();
	session.defaultSession.webRequest.onBeforeRequest((details, done) =>
		done({ cancel: !details.url.startsWith("file://") && !details.url.startsWith("devtools://") })
	);
	migrate(getDb(), { migrationsFolder: requireEnvironment("SS_QUEUE_MIGRATIONS") });
	const now = new Date();
	getDb()
		.insert(projects)
		.values({
			id: "project",
			name: "Native queue",
			repoPath: root,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			type: "branch",
			name: "Codex native turn",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	// Historical reports and stored terminal rows must not become current tasks.
	getDb()
		.insert(workspaces)
		.values({
			id: "retired",
			projectId: "project",
			type: "branch",
			name: "Retired workspace",
			currentPhase: "done",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(terminalSessions)
		.values({
			id: "retired-terminal",
			workspaceId: "retired",
			cwd: root,
			title: "Retired",
			sortOrder: 0,
			updatedAt: now,
		})
		.run();
	for (let i = 0; i < 100; i++) {
		const queue = new ActivityQueueService();
		queue.observe({
			sourceId: `historical-pr-${i}`,
			sourceType: "pr",
			fingerprint: "baseline",
			snapshot: {},
			observedAt: 1,
			candidate: null,
		});
		queue.markUnavailable(`historical-pr-${i}`, "PR status not confirmed in this poll");
	}
	getDb()
		.insert(terminalSessions)
		.values({
			id: "terminal",
			workspaceId: "workspace",
			title: "Codex",
			cwd: root,
			sortOrder: 0,
			updatedAt: now,
		})
		.run();
	manager = new AgentSessionManager({
		daemonClient: daemon,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	manager.registerManagedSession({
		terminalId: "terminal",
		workspaceId: "workspace",
		provider: "codex",
		providerSessionId: "native-session",
		skipPermissions: false,
	});
	agentRegistry.set("codex", codexConfig);
	agentRegistry.set("claude", claudeConfig);
	listener.onEvent((event) => {
		const normalized = manager?.handleAgentEvent(event);
		if (normalized) win?.webContents.send("agent:alert", normalized);
	});
	await listener.start();
	setAgentSessionManager(manager);
	setupTRPCIPC(
		router({
			activityQueue: activityQueueRouter,
			workspaces: workspacesRouter,
			agentSessions: agentSessionsRouter,
		})
	);
	win = new BrowserWindow({
		show: false,
		width: 850,
		height: 650,
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
	const js = <T = unknown>(source: string): Promise<T> => contents.executeJavaScript(source);
	const hasCount = (count: number) =>
		js<boolean>(`!!document.querySelector('button[aria-label="Queue ${count}"]')`);
	const click = (label: string) =>
		js(
			`(() => {const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) throw new Error('Missing button'); b.click();})()`
		);
	let provider: "codex" | "claude" = "codex";
	const bridge = join(root, "hook-bridge.cjs");
	writeFileSync(bridge, HOOK_BRIDGE_SOURCE);
	const hookEnv = () => ({
		...process.env,
		ELECTRON_RUN_AS_NODE: "1",
		AGENT_NOTIFY_PORT: String(listener.getPort()),
		AGENT_NOTIFY_TOKEN: "fixture-only-token",
		AGENT_NOTIFY_TERMINAL_ID: "terminal",
		AGENT_NOTIFY_WORKSPACE_ID: "workspace",
		AGENT_NOTIFY_AGENT: provider,
	});
	async function hook(rawEvent: string, turnId: string) {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(process.execPath, [bridge], {
				env: hookEnv(),
				stdio: ["pipe", "ignore", "pipe"],
			});
			child.on("error", reject);
			child.on("exit", (code) =>
				code === 0 ? resolve() : reject(new Error(`Bridge exit ${code}`))
			);
			child.stdin.end(
				JSON.stringify({
					hook_event_name: rawEvent,
					session_id: "native-session",
					[provider === "claude" ? "prompt_id" : "turn_id"]: turnId,
				})
			);
		});
	}
	step = "initial real IPC projection";
	await until(() => hasCount(0));
	// Isolated provider stand-in reads real PTY input and invokes the production
	// bridge with each provider's payload shape. No authenticated user chat is used.
	const fakeAgent = join(root, "input-agent.cjs");
	writeFileSync(
		fakeAgent,
		`
const {spawnSync} = require('node:child_process');
const lines = require('node:readline').createInterface({input:process.stdin});
let turn = 0;
if (process.env.FIXTURE_RESUME) spawnSync(process.execPath, [${JSON.stringify(bridge)}], {
  env: process.env, input:JSON.stringify({hook_event_name:'SessionStart',session_id:'native-session',source:'resume'})
});
console.log('FIXTURE_READY_' + process.env.AGENT_NOTIFY_AGENT);
lines.on('line', line => {
  if (line === '__fixture_exit__') { console.log('FIXTURE_EXIT_' + process.env.AGENT_NOTIFY_AGENT); process.exit(0); }
  const payload = {hook_event_name:'UserPromptSubmit', session_id:'native-session'};
  payload[process.env.AGENT_NOTIFY_AGENT === 'claude' ? 'prompt_id' : 'turn_id'] = 'direct-' + (++turn);
  spawnSync(process.execPath, [${JSON.stringify(bridge)}], {env:process.env, input:JSON.stringify(payload)});
});
`
	);
	const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
	for (provider of ["codex", "claude"] as const) {
		manager.registerManagedSession({
			terminalId: "terminal",
			workspaceId: "workspace",
			provider,
			providerSessionId: "native-session",
			skipPermissions: false,
		});
		const env = hookEnv();
		const assignments = Object.entries(env)
			.filter(([key]) => key.startsWith("AGENT_NOTIFY_") || key === "ELECTRON_RUN_AS_NODE")
			.map(([key, value]) => `${key}=${quote(String(value))}`)
			.join(" ");
		// wake() must invoke only this isolated provider stand-in, never an
		// installed/authenticated CLI. It emits resume but no new prompt.
		writeFileSync(
			join(root, "bin", provider),
			`#!/bin/sh\n${assignments} FIXTURE_RESUME=1 ${quote(process.execPath)} ${quote(fakeAgent)}\n`,
			{ mode: 0o755 }
		);
		daemon.write("terminal", `${assignments} ${quote(process.execPath)} ${quote(fakeAgent)}\r`);
		step = `${provider}: fixture agent reads PTY input`;
		await until(() => terminalOutput.includes(`FIXTURE_READY_${provider}`));
		let turn = 0;
		for (const managed of [true, false]) {
			getDb()
				.update(agentSessions)
				.set({ managed })
				.where(eq(agentSessions.terminalId, "terminal"))
				.run();
			for (const phase of ["done", "blocked"] as const) {
				await setStatus(
					{
						kind: "workspace",
						projectId: "project",
						workspaceId: "workspace",
						...(managed ? {} : { terminalId: "terminal" }),
					},
					{
						phase,
						statusText: "Review result",
						...(phase === "blocked" ? { needs: "Choose approach" } : {}),
					}
				);
				await hook("Stop", turn ? `direct-${turn}` : `initial-${provider}`);
				step = `${provider} ${managed ? "managed" : "manual"}: ${phase} workspace and session attention`;
				await until(() => hasCount(2));
				if (!(await js<boolean>("!!document.querySelector('#activity-queue-panel')")))
					await click("Queue 2");
				await until(() => js<boolean>("!!document.querySelector('#activity-queue-panel')"));
				await click("Open Codex native turn");
				await until(() =>
					js<boolean>("document.activeElement?.classList.contains('xterm-helper-textarea')")
				);
				await contents.insertText("Continue with this approach");
				await until(() => manager?.getSession("terminal")?.state === "running");
				if ((await listCurrentActivityQueue()).totalPending !== 2)
					throw new Error("Opening/typing cleared attention");
				contents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
				contents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
				turn++;
				step = `${provider}: direct input clears both rows through real terminal IPC and generated bridge`;
				await until(() => hasCount(0));
				closeDb();
				if ((await listCurrentActivityQueue()).totalPending !== 0)
					throw new Error("Continued report returned after reopen");
			}
		}
		getDb()
			.update(agentSessions)
			.set({ managed: true })
			.where(eq(agentSessions.terminalId, "terminal"))
			.run();
		await hook("Stop", `direct-${turn}`);
		await until(() => hasCount(1));
		daemon.write("terminal", "__fixture_exit__\r");
		await until(() => terminalOutput.includes(`FIXTURE_EXIT_${provider}`));
		getDb()
			.update(agentSessions)
			.set({ state: "hibernated" })
			.where(eq(agentSessions.terminalId, "terminal"))
			.run();
		terminalOutput = "";
		step = `${provider}: opening a sleeping chat resumes for reading without handling attention`;
		await js("window.electron.terminal.setVisible('terminal', true)");
		await until(() => terminalOutput.includes(`FIXTURE_READY_${provider}`));
		if ((await listCurrentActivityQueue()).totalPending !== 1)
			throw new Error("Wake to read cleared attention");
		await hook("UserPromptSubmit", `after-view-${provider}`);
		await until(() => hasCount(0));
		daemon.write("terminal", "__fixture_exit__\r");
		await until(() => terminalOutput.includes(`FIXTURE_EXIT_${provider}`));
		terminalOutput = "";
	}
	provider = "codex";
	manager.registerManagedSession({
		terminalId: "terminal",
		workspaceId: "workspace",
		provider,
		providerSessionId: "native-session",
		skipPermissions: false,
	});
	if (await js<boolean>("!!document.querySelector('#activity-queue-panel')"))
		await click("Close Queue");
	await hook("UserPromptSubmit", "turn-1");
	await hook("Stop", "turn-1");
	step = "hook delivery to rendered queue";
	await until(() => hasCount(1));
	await click("Queue 1");
	await until(() => js<boolean>("!!document.querySelector('#activity-queue-panel')"));
	if (
		await js<boolean>(
			"document.body.textContent.includes('Retired workspace') || document.body.textContent.includes('PR status not confirmed in this poll')"
		)
	)
		throw new Error("Historical workspace or inactive PR errors leaked into queue");
	if (!(await js<boolean>("document.body.textContent.includes('Ready for next input')")))
		throw new Error("Missing turn-ready label");
	await click("Handle & next");
	step = "acknowledgment persisted via real IPC";
	await until(() => hasCount(0));
	closeDb();
	if ((await listCurrentActivityQueue()).totalPending !== 0)
		throw new Error("Receipt lost after SQLite reopen");
	await hook("Stop", "turn-1");
	if ((await listCurrentActivityQueue()).totalPending !== 0)
		throw new Error("Duplicate Stop resurrected handled row");
	await hook("UserPromptSubmit", "turn-2");
	await hook("PreCompact", "turn-2");
	await hook("PostCompact", "turn-2");
	await hook("PermissionRequest", "turn-2");
	step = "same-session next-turn input";
	await until(() => hasCount(1));
	await until(() => js<boolean>("document.body.textContent.includes('Agent needs input')"));
	const beforeDisconnect = (await listCurrentActivityQueue()).items.map((item) => item.id);
	daemon.disconnect();
	const disconnected = await listCurrentActivityQueue();
	if (
		disconnected.agentStatusAvailable ||
		JSON.stringify(disconnected.items.map((item) => item.id)) !== JSON.stringify(beforeDisconnect)
	)
		throw new Error("Daemon disconnect discarded last-confirmed queue state");
	await daemon.connect();
	const reconnected = await listCurrentActivityQueue();
	if (
		!reconnected.agentStatusAvailable ||
		JSON.stringify(reconnected.items.map((item) => item.id)) !== JSON.stringify(beforeDisconnect)
	)
		throw new Error("Daemon reconnect changed unchanged queue activity");
	await hook("Stop", "turn-1");
	if ((await listCurrentActivityQueue()).items[0]?.kind !== "agent-input")
		throw new Error("Late prior-turn Stop overwrote input");
	const pr: CachedPR = {
		provider: "github",
		identifier: "owner/repo#7",
		number: 7,
		title: "Native review request",
		state: "open",
		sourceBranch: "feature",
		targetBranch: "main",
		author: { login: "author", avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: now.toISOString(),
		repoOwner: "owner",
		repoName: "repo",
		projectId: "project",
		role: "reviewer",
		headCommitSha: "a",
	};
	observePRActivity(
		pr,
		{ state: "open", isDraft: false, reviewRequested: true, headSha: "a" },
		[],
		Date.now(),
		new ActivityQueueService(),
		undefined,
		"Native queue"
	);
	new ActivityQueueService().markUnavailable(
		prSourceId(pr),
		"Some PR review metadata is unavailable"
	);
	await until(() =>
		js<boolean>(
			"[...document.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Refresh queue' && !b.disabled)"
		)
	);
	await click("Refresh queue");
	step = "PR and agent rows together";
	await until(() => hasCount(2));
	await until(() => js<boolean>("document.body.textContent.includes('Native review request')"));
	if (
		!(await js<boolean>(
			"!!document.querySelector('details') && !document.querySelector('details').open && document.querySelectorAll('details li').length === 1"
		))
	)
		throw new Error("PR warnings are not compact and collapsed");
	for (const [width, height] of [
		[800, 600],
		[1440, 900],
	]) {
		if (!width || !height) throw new Error("Missing viewport");
		win.setContentSize(width, height);
		await new Promise((resolve) => setTimeout(resolve, 80));
		const bounds = await js<{
			width: number;
			height: number;
			right: number;
			bottom: number;
			viewportWidth: number;
			viewportHeight: number;
		}>(
			"(() => { const r = document.querySelector('#activity-queue-panel').getBoundingClientRect(); return { width:r.width, height:r.height, right:r.right,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight }; })()"
		);
		if (
			bounds.width < 280 ||
			bounds.right > bounds.viewportWidth + 1 ||
			bounds.bottom > bounds.viewportHeight + 1
		)
			throw new Error("Queue does not fit viewport");
		await js("document.querySelector('#activity-queue-panel').focus()");
		contents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
		contents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
		await until(() =>
			js<boolean>("document.activeElement?.getAttribute('aria-label') === 'Refresh queue'")
		);
		if (
			!(await js<boolean>("parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2"))
		)
			throw new Error(
				`Keyboard focus is not visible: ${await js<string>("JSON.stringify({hasFocus:document.hasFocus(),visible:document.activeElement.matches(':focus-visible'),style:getComputedStyle(document.activeElement).outlineStyle,width:getComputedStyle(document.activeElement).outlineWidth})")}`
			);
		await contents
			.capturePage()
			.then((capture) =>
				writeFileSync(join(root, `queue-${width}x${height}.png`), capture.toPNG())
			);
	}
	const longTitle =
		"Review payment reconciliation after failed retries across multiple linked repositories and long-running workspace sessions";
	observePRActivity(
		{ ...pr, title: longTitle },
		{ state: "open", isDraft: false, reviewRequested: true, headSha: "a" },
		[],
		Date.now(),
		new ActivityQueueService(),
		undefined,
		"Native queue"
	);
	await until(() =>
		js<boolean>("!document.querySelector('button[aria-label=\"Refresh queue\"]').disabled")
	);
	await click("Refresh queue");
	await until(() =>
		js<boolean>(`document.body.textContent.includes(${JSON.stringify(longTitle)})`)
	);
	await click(`Open ${longTitle}`);
	await until(() => js<boolean>("!!document.querySelector('#activity-queue-panel [role=alert]')"));
	win.setContentSize(800, 600);
	await new Promise((resolve) => setTimeout(resolve, 80));
	if (
		!(await js<boolean>(
			"document.documentElement.scrollWidth <= innerWidth && document.querySelector('button[aria-label^=\"Handle \"]').getBoundingClientRect().bottom <= innerHeight"
		))
	)
		throw new Error("Long content overflows the dock actions");
	await contents
		.capturePage()
		.then((capture) => writeFileSync(join(root, "queue-800x600-long.png"), capture.toPNG()));
	observePRActivity(
		pr,
		{ state: "open", isDraft: false, reviewRequested: true, headSha: "a" },
		[],
		Date.now(),
		new ActivityQueueService(),
		undefined,
		"Native queue"
	);
	await click("Refresh queue");
	await until(() => js<boolean>("document.body.textContent.includes('Native review request')"));
	const before = (await listCurrentActivityQueue()).totalPending;
	await click("Open Codex native turn");
	step = "source navigation keeps dock open";
	await until(() =>
		js<boolean>("document.activeElement?.classList.contains('xterm-helper-textarea')")
	);
	if (!(await js<boolean>("!!document.querySelector('#activity-queue-panel')")))
		throw new Error("Opening source closed the dock");
	contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
	contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
	if (!(await js<boolean>("!!document.querySelector('#activity-queue-panel')")))
		throw new Error("Queue intercepted terminal Escape");
	if ((await listCurrentActivityQueue()).totalPending !== before)
		throw new Error("Open acknowledged attention");
	await click("Handle & next");
	step = "next item remains visible when navigation fails";
	await until(() => hasCount(1));
	await until(() => js<boolean>("!!document.querySelector('#activity-queue-panel [role=alert]')"));
	if (
		!(await js<boolean>(
			"document.querySelector('button[aria-current=true]')?.getAttribute('aria-label') === 'Open Native review request'"
		))
	)
		throw new Error("Handle and next did not select the next item");
	await js("document.querySelector('#activity-queue-panel').focus()");
	contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
	contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
	await until(() => js<boolean>("!document.querySelector('#activity-queue-panel')"));
	await until(() =>
		js<boolean>("document.activeElement?.getAttribute('aria-label') === 'Queue 1'")
	);
	step = "atomic attach through production preload and main IPC";
	if (createdPtys !== 1) throw new Error("Expected one fixture shell");
	const attachScript = `window.electron.terminal.create('terminal', ${JSON.stringify(root)}, 'workspace', 'attach-existing-only')`;
	const attached = await js<{ wasAttached: boolean }>(attachScript);
	if (!attached.wasAttached || createdPtys !== 1) throw new Error("Guarded attach created a shell");
	disappearOnAttach = true;
	const message = await js<string>(
		`${attachScript}.then(() => 'unexpected-success', error => error.message)`
	);
	const code = terminalCreateErrorCode(new Error(message));
	if (code !== "TERMINAL_NOT_RUNNING" || createdPtys !== 1 || ptys.has("terminal"))
		throw new Error(`Native IPC race failed: ${code}, creates=${createdPtys}`);
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify({
			nativeIPC: true,
			durableReceipt: true,
			repeatedTurns: true,
			compaction: true,
			lateStopRejected: true,
			prProjection: true,
			openDoesNotAcknowledge: true,
			focusReturn: true,
			atomicAttachOnly: true,
			directChatInputClearsDispatch: true,
			typingWithoutSubmitPreservesAttention: true,
			codexAndClaudeBridge: true,
			wakeToReadPreservesAttention: true,
		})
	);
}
run().then(
	() => finish(0),
	(error) => {
		console.error(step, error);
		finish(1);
	}
);
function finish(code: number) {
	listener.stop();
	manager?.dispose();
	setAgentSessionManager(null);
	daemon.disconnect();
	setDaemonClient(null);
	socketServer.close();
	ptys.disposeAll();
	closeDb();
	win?.destroy();
	app.exit(code);
}
