import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app, session } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { observePRActivity } from "../../../src/main/activity-queue/pr-source";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { closeDb, getDb } from "../../../src/main/db";
import { projects, terminalSessions, workspaces } from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
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
	throw new Error(`Timed out: ${step}`);
};
async function run() {
	await app.whenReady();
	socketServer.listen();
	await daemon.connect();
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
	listener.onEvent((event) => {
		const normalized = manager?.handleAgentEvent(event);
		if (normalized) win?.webContents.send("agent:alert", normalized);
	});
	await listener.start();
	setupTRPCIPC(router({ activityQueue: activityQueueRouter }));
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
	const js = <T = unknown>(source: string): Promise<T> => contents.executeJavaScript(source);
	const hasCount = (count: number) =>
		js<boolean>(`!!document.querySelector('button[aria-label="Queue ${count}"]')`);
	const click = (label: string) =>
		js(
			`(() => {const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) throw new Error('Missing button'); b.click();})()`
		);
	let stamp = Date.now();
	async function hook(rawEvent: string, turnId: string) {
		const params = new URLSearchParams({
			rawEvent,
			terminalId: "terminal",
			workspaceId: "workspace",
			providerSessionId: "native-session",
			agent: "codex",
			turnId,
			producerTimestamp: String(++stamp),
		});
		const response = await fetch(`http://127.0.0.1:${listener.getPort()}/event?${params}`, {
			headers: { Authorization: "Bearer fixture-only-token" },
		});
		if (!response.ok) throw new Error(`Hook failed: ${response.status}`);
	}
	step = "initial real IPC projection";
	await until(() => hasCount(0));
	await hook("UserPromptSubmit", "turn-1");
	await hook("Stop", "turn-1");
	step = "hook delivery to rendered queue";
	await until(() => hasCount(1));
	await click("Queue 1");
	await until(() => js<boolean>("!!document.querySelector('dialog[open]')"));
	if (!(await js<boolean>("document.body.textContent.includes('Ready for next input')")))
		throw new Error("Missing turn-ready label");
	await click("Handled");
	step = "acknowledgment persisted via real IPC";
	await until(() => hasCount(0));
	closeDb();
	if (new ActivityQueueService().list().totalPending !== 0)
		throw new Error("Receipt lost after SQLite reopen");
	await hook("Stop", "turn-1");
	if (new ActivityQueueService().list().totalPending !== 0)
		throw new Error("Duplicate Stop resurrected handled row");
	await hook("UserPromptSubmit", "turn-2");
	await hook("PreCompact", "turn-2");
	await hook("PostCompact", "turn-2");
	await hook("PermissionRequest", "turn-2");
	step = "same-session next-turn input";
	await until(() => hasCount(1));
	await until(() => js<boolean>("document.body.textContent.includes('Agent needs input')"));
	await hook("Stop", "turn-1");
	if (new ActivityQueueService().list().items[0]?.kind !== "agent-input")
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
	await until(() =>
		js<boolean>(
			"[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Refresh' && !b.disabled)"
		)
	);
	await click("Refresh");
	step = "PR and agent rows together";
	await until(() => hasCount(2));
	await until(() => js<boolean>("document.body.textContent.includes('Native review request')"));
	await contents
		.capturePage()
		.then((capture) => writeFileSync(join(root, "queue.png"), capture.toPNG()));
	const before = new ActivityQueueService().list().totalPending;
	await click("Open");
	step = "failed navigation does not handle item";
	await until(() =>
		js<boolean>(
			"!!document.querySelector('li [role=alert]') || document.body.textContent.includes('Unable') || document.body.textContent.includes('No procedure')"
		)
	);
	if (new ActivityQueueService().list().totalPending !== before)
		throw new Error("Open acknowledged attention");
	contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
	contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
	await until(() => js<boolean>("!document.querySelector('dialog[open]')"));
	await until(() =>
		js<boolean>("document.activeElement?.getAttribute('aria-label') === 'Queue 2'")
	);
	step = "atomic attach through production preload and main IPC";
	await daemon.create(
		"terminal",
		root,
		() => {},
		() => {},
		{ SHELL: "/bin/sh", HOME: root }
	);
	await daemon.listSessionsStrict();
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
	daemon.disconnect();
	socketServer.close();
	ptys.disposeAll();
	closeDb();
	win?.destroy();
	app.exit(code);
}
