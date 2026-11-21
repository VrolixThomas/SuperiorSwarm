import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app } from "electron";
import { z } from "zod";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { listWorkspaceQueue } from "../../../src/main/activity-queue/workspace-queue";
import { claudeConfig } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import {
	publishHookEndpoint,
	setPermissionResponseEnabled,
} from "../../../src/main/agent-hooks/endpoint";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import {
	decideQueuePermission,
	getQueuePermissionCapability,
	queuePermissions,
	resolvePermissionEvent,
} from "../../../src/main/agent-hooks/permission-runtime";
import { setPermissionTerminalVisibility } from "../../../src/main/agent-hooks/permission-visibility";
import { getDb } from "../../../src/main/db";
import { projects, terminalSessions, workspaces } from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { publicProcedure, router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { agentRegistry } from "../../../src/shared/agent-events";
const root = process.env["SS_QUEUE_FIXTURE_ROOT"]!;
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});
const ptys = new PtyManager();
const socket = join(root, "daemon.sock");
const server = new SocketServer(ptys, { flush: () => [] } as unknown as ScrollbackStore, socket);
const daemon = new DaemonClient(socket, join(root, "pid"), join(root, "daemon.log"));
const manager = new AgentSessionManager({
	daemonClient: daemon,
	processController: {
		inspectForeground: async () => ({ status: "missing" }),
		terminateForeground: async () => ({ ok: true }),
	},
	getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
});
const token = randomUUID();
const listener = createAlertListener(0, token, {
	service: queuePermissions,
	resolve: resolvePermissionEvent,
});
listener.onEvent((e) => {
	const accepted = manager.handleAgentEvent(e);
	console.log("PERMISSION_EVENT", e.agent, e.rawEvent, !!accepted);
});
let win: BrowserWindow | undefined;
export const fixtureRouter = router({
	permissionFixture: router({
		list: publicProcedure.query(async () => {
			const result = await listWorkspaceQueue();
			return result.items.map((item) => ({ item, capability: getQueuePermissionCapability(item) }));
		}),
		decide: publicProcedure
			.input(
				z.object({
					id: z.string(),
					revision: z.number(),
					members: z.array(z.object({ id: z.string(), revision: z.number() })).optional(),
					requestId: z.string(),
					action: z.enum(["allow-once", "deny", "open"]),
				})
			)
			.mutation(({ input }) => decideQueuePermission(input)),
	}),
});
const until = async (fn: () => boolean | Promise<boolean>) => {
	for (let i = 0; i < 240; i++) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	console.log(
		"PERMISSION_ROWS",
		JSON.stringify(
			(await listWorkspaceQueue()).items.map((item) => ({
				id: item.id,
				target: item.target,
				permission: item.permission,
				capability: getQueuePermissionCapability(item),
			}))
		)
	);
	throw Error("Native permission fixture wait expired");
};
async function run() {
	await app.whenReady();
	server.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	migrate(getDb(), { migrationsFolder: process.env["SS_QUEUE_MIGRATIONS"]! });
	agentRegistry.set("claude", claudeConfig);
	agentRegistry.set("codex", codexConfig);
	await listener.start();
	setPermissionResponseEnabled(true);
	writeFileSync(join(root, "bridge.cjs"), HOOK_BRIDGE_SOURCE);
	writeFileSync(
		join(root, "provider.cjs"),
		`const fs=require('node:fs'),cp=require('node:child_process');process.title=process.env.AGENT_NOTIFY_AGENT;const base={session_id:process.env.FIXTURE_SESSION,cwd:process.cwd(),turn_id:'turn'};function hook(event,extra={}){return cp.spawnSync(process.execPath,[process.env.FIXTURE_BRIDGE],{env:process.env,input:JSON.stringify({...base,hook_event_name:event,...extra}),encoding:'utf8'}).stdout;}hook('SessionStart',{source:'startup',turn_id:undefined});hook('UserPromptSubmit');const response=hook('PermissionRequest',{tool_name:'Bash',tool_input:{command:'printf synthetic'}});fs.writeFileSync(process.env.FIXTURE_RESULT,response||'native-fallback');setInterval(()=>{},1000);`
	);
	writeFileSync(
		join(root, "provider.sh"),
		'#!/bin/sh\nexec "$SS_NODE_EXECUTABLE" "$FIXTURE_PROVIDER"\n',
		{ mode: 0o755 }
	);
	const now = new Date();
	getDb()
		.insert(projects)
		.values({ id: "p", name: "Permission fixture", repoPath: root, createdAt: now, updatedAt: now })
		.run();
	getDb()
		.insert(workspaces)
		.values({
			id: "w",
			projectId: "p",
			name: "Synthetic permission queue",
			type: "worktree",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	for (const provider of ["claude", "codex", "visible", "handoff", "unknown"]) {
		getDb()
			.insert(terminalSessions)
			.values({
				id: provider,
				workspaceId: "w",
				cwd: root,
				title: `${provider} fixture`,
				sortOrder: 0,
				updatedAt: now,
			})
			.run();
		const providerSessionId = randomUUID();
		manager.registerManagedSession({
			terminalId: provider,
			workspaceId: "w",
			provider: provider === "claude" ? "claude" : "codex",
			providerSessionId,
			skipPermissions: false,
		});
		if (provider !== "unknown") setPermissionTerminalVisibility(provider, provider === "visible");
		publishHookEndpoint(provider, listener.getPort()!, token, join(root, "endpoints"));
		await daemon.create(
			provider,
			root,
			(data) => {
				if (data.includes("Error") || data.includes("not found"))
					console.error("FIXTURE_PTY_ERROR", provider, data);
			},
			() => {},
			{
				SHELL: join(root, "provider.sh"),
				HOME: root,
				SS_NODE_EXECUTABLE: process.env["SS_NODE_EXECUTABLE"]!,
				FIXTURE_PROVIDER: join(root, "provider.cjs"),
				FIXTURE_BRIDGE: join(root, "bridge.cjs"),
				FIXTURE_RESULT: join(root, `${provider}-result.txt`),
				FIXTURE_SESSION: providerSessionId,
				AGENT_NOTIFY_TERMINAL_ID: provider,
				AGENT_NOTIFY_WORKSPACE_ID: "w",
				AGENT_NOTIFY_AGENT: provider === "claude" ? "claude" : "codex",
				AGENT_NOTIFY_TOKEN: token,
				AGENT_NOTIFY_PORT: String(listener.getPort()),
			}
		);
		daemon.write(provider, 'exec "$SS_NODE_EXECUTABLE" "$FIXTURE_PROVIDER"\r');
	}
	await until(
		async () =>
			(await listWorkspaceQueue()).items.filter(
				(i) => getQueuePermissionCapability(i).capability === "hook-response"
			).length === 3
	);
	setupTRPCIPC(fixtureRouter);
	setupTerminalIPC(daemon, manager);
	win = new BrowserWindow({
		show: false,
		width: 860,
		height: 700,
		webPreferences: {
			preload: join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			backgroundThrottling: false,
		},
	});
	rendererTrust.register(win.webContents.id, pathToFileURL(join(root, "index.html")).href);
	await win.loadFile(join(root, "index.html"));
	win.show();
	app.focus({ steal: true });
	win.focus();
	win.webContents.focus();
	const js = (code: string) => win!.webContents.executeJavaScript(code);
	await until(() =>
		js(`document.querySelectorAll('[aria-label="Permission decision"]').length===5`)
	);
	await until(
		() =>
			existsSync(join(root, "visible-result.txt")) && existsSync(join(root, "unknown-result.txt"))
	);
	assert.equal(readFileSync(join(root, "visible-result.txt"), "utf8"), "native-fallback");
	assert.equal(readFileSync(join(root, "unknown-result.txt"), "utf8"), "native-fallback");
	const beforeHandoff = (await listWorkspaceQueue()).items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === "handoff"
	);
	assert.ok(beforeHandoff);
	await js(`window.electron.terminal.setVisible("handoff",true)`);
	await until(() => existsSync(join(root, "handoff-result.txt")));
	assert.equal(readFileSync(join(root, "handoff-result.txt"), "utf8"), "native-fallback");
	const afterHandoff = (await listWorkspaceQueue()).items.find((i) => i.id === beforeHandoff.id);
	assert.equal(afterHandoff?.revision, beforeHandoff.revision);
	assert.equal(existsSync(join(root, "claude-result.txt")), false);
	assert.equal(existsSync(join(root, "codex-result.txt")), false);
	await js(
		`Array.from(document.querySelector('[data-terminal="claude"]').querySelectorAll('button')).find(b=>b.textContent==='Allow once').click()`
	);
	await until(() => existsSync(join(root, "claude-result.txt")));
	assert.equal(
		JSON.parse(readFileSync(join(root, "claude-result.txt"), "utf8")).hookSpecificOutput.decision
			.behavior,
		"allow"
	);
	assert.equal(existsSync(join(root, "codex-result.txt")), false);
	await js(
		`Array.from(document.querySelector('[data-terminal="codex"]').querySelectorAll('button')).find(b=>b.textContent==='Deny').click()`
	);
	await until(() => existsSync(join(root, "codex-result.txt")));
	assert.equal(
		JSON.parse(readFileSync(join(root, "codex-result.txt"), "utf8")).hookSpecificOutput.decision
			.behavior,
		"deny"
	);
	await until(() =>
		js(`document.body.innerText.includes('Provider acceptance and action outcome remain unknown')`)
	);
	const rows = (await listWorkspaceQueue()).items;
	assert.equal(rows.length, 5);
	for (const row of rows.filter(
		(i) => i.target.type === "terminal" && ["claude", "codex"].includes(i.target.terminalId)
	))
		assert.equal(getQueuePermissionCapability(row).state, "delivered-to-hook");
	writeFileSync(join(root, "permission-native.png"), (await win.webContents.capturePage()).toPNG());
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify({
			native: true,
			realProviders: false,
			uiToHookReceipt: true,
			siblingIsolation: true,
			attentionPreserved: true,
			nativeVisibilityFallback: true,
		})
	);
}
function finish(code: number) {
	listener.stop();
	manager.dispose();
	daemon.disconnect();
	setDaemonClient(null);
	server.close();
	ptys.disposeAll();
	win?.destroy();
	setTimeout(() => app.exit(code), 100);
}
run()
	.then(() => finish(0))
	.catch((e) => {
		console.error(e);
		finish(1);
	});
