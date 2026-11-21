import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import {
	workspaceReply,
	workspaceReplyCapability,
} from "../../../src/main/activity-queue/conversation-replies";
import { listWorkspaceQueue } from "../../../src/main/activity-queue/workspace-queue";
import { claudeConfig, mergeClaudeHooks } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { closeDb, getDb } from "../../../src/main/db";
import {
	activityQueueDeliveries,
	projects,
	terminalSessions,
	workspaces,
} from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
import { agentRegistry } from "../../../src/shared/agent-events";
import { codexHookTrust } from "./codex-hooks";
const root = process.env["SS_QUEUE_FIXTURE_ROOT"]!;
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "logs"));
app.disableHardwareAcceleration();
const ptys = new PtyManager();
const daemon = new DaemonClient(
	join(root, "terminal.sock"),
	join(root, "pid"),
	join(root, "daemon.log")
);
const token = randomUUID();
const listener = createAlertListener(0, token);
let socket: SocketServer;
let manager: AgentSessionManager;
let win: BrowserWindow;
const trace: {
	event?: string;
	provider: string;
	conversation: string;
	terminal: string;
	accepted: boolean;
	evidence?: { text: string }[];
	promptHash?: string;
	turnId?: string;
}[] = [];
let output = "";
let step = "startup";
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
async function until(fn: () => boolean | Promise<boolean>, ms = 60000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw Error(`Timeout: ${step}`);
}
async function run() {
	await app.whenReady();
	migrate(getDb(), { migrationsFolder: process.env["SS_QUEUE_MIGRATIONS"]! });
	socket = new SocketServer(
		ptys,
		new ScrollbackStore(getDb().$client),
		join(root, "terminal.sock")
	);
	socket.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	manager = new AgentSessionManager({
		daemonClient: daemon,
		processController: {
			inspectForeground: async () => ({ status: "unknown", error: "not used" }),
			terminateForeground: async () => ({ ok: false, error: "not used" }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	setAgentSessionManager(manager);
	agentRegistry.set("claude", claudeConfig);
	agentRegistry.set("codex", codexConfig);
	listener.onEvent((event) => {
		const accepted = manager.handleAgentEvent(event);
		trace.push({
			event: event.rawEvent,
			turnId: event.turnId,
			provider: event.agent,
			conversation: event.providerSessionId,
			terminal: event.terminalId,
			accepted: !!accepted,
			evidence: event.evidence,
			promptHash: event.promptHash,
		});
	});
	await listener.start();
	setupTRPCIPC(router({ activityQueue: activityQueueRouter }));
	win = new BrowserWindow({
		width: 1280,
		height: 850,
		show: false,
		webPreferences: {
			preload: join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	win.webContents.on("before-input-event", (event) => event.preventDefault());
	await win.loadFile(join(root, "index.html"));
	win.show();
	app.focus({ steal: true });
	win.focus();
	win.webContents.focus();
	const provider = process.env["SS_QUEUE_NATIVE_CASES"] === "codex" ? "codex" : "claude";
	const now = new Date();
	const synthetic = join(root, "synthetic-repo");
	mkdirSync(synthetic);
	execFileSync("git", ["init", "-q", synthetic]);
	const cwd =
		(provider === "claude" ? process.env["SS_QUEUE_TRUSTED_CWD"] : undefined) || synthetic;
	getDb()
		.insert(projects)
		.values({
			id: "project",
			name: "Queue TUI synthetic fixture",
			repoPath: cwd,
			defaultBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			name: "Exact TUI reply",
			type: "branch",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const terminalId = "actual-provider";
	getDb()
		.insert(terminalSessions)
		.values({
			id: terminalId,
			workspaceId: "workspace",
			title: `Actual ${provider} TUI`,
			cwd,
			sortOrder: 0,
			updatedAt: now,
		})
		.run();
	const bridge = join(root, "bridge.cjs");
	writeFileSync(bridge, HOOK_BRIDGE_SOURCE);
	mergeClaudeHooks(
		join(root, "settings.json"),
		`ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(bridge)}`
	);
	const env = {
		...Object.fromEntries(
			Object.entries(process.env).filter(
				(entry): entry is [string, string] =>
					!!entry[1] &&
					!entry[0].startsWith("SUPERIORSWARM_") &&
					!entry[0].startsWith("AGENT_NOTIFY_") &&
					entry[0] !== "ELECTRON_RUN_AS_NODE" &&
					entry[0] !== "CLAUDECODE"
			)
		),
		AGENT_NOTIFY_PORT: String(listener.getPort()),
		AGENT_NOTIFY_TOKEN: token,
		AGENT_NOTIFY_WORKSPACE_ID: "workspace",
		AGENT_NOTIFY_TERMINAL_ID: terminalId,
		AGENT_NOTIFY_AGENT: provider,
	};
	await daemon.create(
		terminalId,
		cwd,
		(data) => {
			output = (output + data).slice(-100000);
			writeFileSync(join(root, "tui-output.txt"), output);
			if (data.includes("\x1b[6n")) daemon.write(terminalId, "\x1b[1;1R");
		},
		() => {},
		env
	);
	const prompt = "Reply with exactly QUEUE_TUI_INITIAL. Do not use tools or change files.";
	let args: string[];
	if (provider === "claude")
		args = [
			"--setting-sources",
			"",
			"--settings",
			join(root, "settings.json"),
			"--strict-mcp-config",
			"--mcp-config",
			'{"mcpServers":{}}',
			"--tools",
			"",
			"--permission-mode",
			"plan",
			"--disable-slash-commands",
			"--session-id",
			randomUUID(),
			prompt,
		];
	else {
		const hookCommand = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(bridge)}`;
		const hookEvents = Object.fromEntries(
			["SessionStart", "UserPromptSubmit", "Stop", "PermissionRequest"].map((event) => [
				event,
				[{ hooks: [{ type: "command", command: hookCommand, timeout: 35 }] }],
			])
		);
		const state = await codexHookTrust(
			process.env["SS_QUEUE_CODEX_BIN"]!,
			cwd,
			hookEvents,
			env,
			bridge
		);
		const configured = TOML.parse(readFileSync(join(homedir(), ".codex/config.toml"), "utf8")) as {
			mcp_servers?: Record<string, unknown>;
		};
		const disableMcp = Object.keys(configured.mcp_servers ?? {}).flatMap((name) => [
			"-c",
			`mcp_servers.${JSON.stringify(name)}.enabled=false`,
		]);
		args = [
			"--no-daemon",
			...disableMcp,
			"-c",
			`hooks=${TOML.stringify.value({ ...hookEvents, state })}`,
			"-c",
			`projects=${TOML.stringify.value({ [cwd]: { trust_level: "trusted" } })}`,
			"-c",
			"mcp_servers={}",
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"read-only",
			"--no-alt-screen",
			prompt,
		];
	}
	const bin = process.env[provider === "claude" ? "SS_QUEUE_CLAUDE_BIN" : "SS_QUEUE_CODEX_BIN"]!;
	writeFileSync(
		join(root, "launch.sh"),
		`#!/bin/sh\nexec ${[bin, ...args].map(quote).join(" ")}\n`,
		{ mode: 0o700 }
	);
	daemon.write(terminalId, `/bin/sh ${quote(join(root, "launch.sh"))}\r`);
	step = "actual initial TUI turn";
	await until(async () =>
		(await listWorkspaceQueue()).items.some(
			(i) =>
				i.target.type === "terminal" &&
				i.target.terminalId === terminalId &&
				i.situation === "agent-done"
		)
	);
	const item = (await listWorkspaceQueue()).items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === terminalId
	)!;
	const capability = await workspaceReplyCapability(item);
	assert.equal(capability.status, "available", JSON.stringify(capability));
	await win.webContents.executeJavaScript("window.queueReplyProbe.refresh()");
	step = "rendered reply control";
	await until(() =>
		win.webContents.executeJavaScript(
			"!!document.querySelector('[aria-label=\"Reply to conversation\"] textarea')"
		)
	);
	app.focus({ steal: true });
	win.focus();
	win.webContents.focus();
	await new Promise((resolve) => setTimeout(resolve, 400));
	await win.webContents.executeJavaScript(
		"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"
	);
	await win.webContents
		.capturePage()
		.then((image) => writeFileSync(join(root, "before.png"), image.toPNG()));
	const content = "Reply with exactly QUEUE_TUI_FOLLOWUP. Do not use tools or change files.";
	await win.webContents.executeJavaScript(
		`(()=>{const el=document.querySelector('[aria-label="Reply to conversation"] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(content)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`
	);
	await until(() =>
		win.webContents.executeJavaScript(
			"[...document.querySelectorAll('button')].some(b=>b.textContent==='Send reply'&&!b.disabled)"
		)
	);
	step = "Queue reply to actual TUI";
	await win.webContents.executeJavaScript(
		"[...document.querySelectorAll('button')].find(b=>b.textContent==='Send reply').click()"
	);
	await until(() =>
		getDb()
			.select()
			.from(activityQueueDeliveries)
			.all()
			.some((r) => r.state === "admitted")
	);
	const delivery = getDb().select().from(activityQueueDeliveries).all()[0]!;
	assert(
		["admitted", "received"].includes(
			(
				await workspaceReply({
					id: item.id,
					revision: item.revision,
					members: item.members,
					requestId: delivery.requestId,
					content,
				})
			).status
		)
	);
	step = "real provider followup receipt";
	await until(() =>
		trace.some(
			(event) =>
				event.event === "Stop" &&
				event.accepted &&
				event.evidence?.some((value) => value.text === "QUEUE_TUI_FOLLOWUP")
		)
	);
	assert.equal(
		(
			await workspaceReply({
				id: item.id,
				revision: item.revision,
				members: item.members,
				requestId: delivery.requestId,
				content,
			})
		).status,
		"received"
	);
	const after = (await listWorkspaceQueue()).items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === terminalId
	);
	assert(after?.target.type === "terminal" && item.target.type === "terminal");
	assert.equal(after.target.providerSessionId, item.target.providerSessionId);
	assert.equal(
		new Set(
			trace
				.filter((event) => event.event === "UserPromptSubmit" && event.accepted)
				.map((event) => event.turnId)
		).size,
		2
	);
	await win.webContents.executeJavaScript("window.queueReplyProbe.refresh()");
	await new Promise((r) => setTimeout(r, 400));
	await win.webContents
		.capturePage()
		.then((image) => writeFileSync(join(root, "after.png"), image.toPNG()));
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify(
			{
				passed: true,
				provider,
				mode: "actual interactive provider TUI",
				target: item.target,
				delivery: delivery.state,
				providerReceipt: "received",
				trace,
			},
			null,
			2
		)
	);
}
async function finish(code: number) {
	writeFileSync(join(root, "trace.json"), JSON.stringify({ step, trace }, null, 2));
	writeFileSync(join(root, "tui-output.txt"), output);
	listener.stop();
	manager?.dispose();
	setAgentSessionManager(null);
	daemon.disconnect();
	socket?.close();
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
