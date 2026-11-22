import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import TOML from "@iarna/toml";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { readTerminalProcessIdentity } from "../../../src/daemon/terminal-process-identity";
import { fixProjectHook } from "../../../src/main/activity-queue/hook-actions";
import { readQueueHookConfig } from "../../../src/main/activity-queue/hook-config";
import {
	projectHookSourceId,
	reconcileProjectHookOutput,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../../../src/main/activity-queue/hook-source";
import { isPRQueueItemCurrent } from "../../../src/main/activity-queue/pr-scope";
import { solveQueuePRFeedback } from "../../../src/main/activity-queue/pr-solve";
import { describePRQueueItem } from "../../../src/main/activity-queue/pr-source";
import { registerExternalQueueAdapter } from "../../../src/main/activity-queue/queue-view";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { claudeConfig, mergeClaudeHooks } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { setAgentNotifyPort, setAgentNotifyToken } from "../../../src/main/agent-hooks/port";
import { registerConfirmBridge } from "../../../src/main/control-plane/confirm-bridge";
import { TaskRegistry } from "../../../src/main/control-plane/task-registry";
import { closeDb, getDb } from "../../../src/main/db";
import {
	aiReviewSettings,
	prComments,
	projects,
	terminalSessions,
	workspaces,
	worktrees,
} from "../../../src/main/db/schema";
import { saveAuth } from "../../../src/main/github/auth";
import { registerGitProvider } from "../../../src/main/providers/git-provider";
import type { GitProvider } from "../../../src/main/providers/types";
import { PosixAgentProcessController } from "../../../src/main/services/agent-process-controller";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { setTaskRegistry } from "../../../src/main/services/task-registry-handle";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { agentRegistry } from "../../../src/shared/agent-events";
import { codexHookTrust } from "../queue-reply-tui/codex-hooks";

const root = process.env["SS_QUEUE_FIXTURE_ROOT"]!;
const provider = process.env["SS_QUEUE_NATIVE_CASES"] === "codex" ? "codex" : "claude";
const scenario = process.env["SS_QUEUE_LAUNCH_KIND"] === "pr" ? "pr" : "hook";
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
let manager: AgentSessionManager;
let socket: SocketServer;
let win: BrowserWindow;
let launchDir: string | undefined;
let step = "setup";
const trace: {
	event?: string;
	provider: string;
	terminal: string;
	conversation: string;
	accepted: boolean;
	cwd?: string;
	launchId?: string;
}[] = [];
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
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
	assert(app.getAppPath().startsWith(root));
	symlinkSync(
		join(process.env["SS_QUEUE_SOURCE_DESKTOP"]!, "mcp-standalone"),
		join(app.getAppPath(), "mcp-standalone")
	);
	migrate(getDb(), { migrationsFolder: process.env["SS_QUEUE_MIGRATIONS"]! });
	const cwd = provider === "claude" ? process.env["SS_QUEUE_TRUSTED_CWD"]! : join(root, "repo");
	assert(
		(cwd && existsSync(cwd)) || provider === "codex",
		"Claude requires an already trusted checkout"
	);
	if (provider === "codex") {
		mkdirSync(cwd);
		execFileSync("git", ["init", "-q", cwd]);
		execFileSync("git", [
			"-C",
			cwd,
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"commit",
			"--allow-empty",
			"-qm",
			"fixture",
		]);
	}
	const now = new Date();
	const oldConversation = randomUUID();
	getDb()
		.insert(projects)
		.values({
			id: "project",
			name: "Native queue fixture",
			repoPath: cwd,
			kind: "repo",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(worktrees)
		.values({
			id: "worktree",
			projectId: "project",
			branch: "fixture",
			baseBranch: "main",
			path: cwd,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(workspaces)
		.values({
			id: "workspace",
			projectId: "project",
			name: "Native queue target",
			type: "worktree",
			worktreeId: "worktree",
			isOrchestrator: true,
			cliPreset: provider,
			cliSessionId: oldConversation,
			prProvider: "github",
			prIdentifier: "fixture/repo#7",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(aiReviewSettings)
		.values({
			id: "default",
			cliPreset: provider,
			skipPermissions: 0,
			solvePrompt:
				"This is a tool-free launch probe. Do not edit, commit, run commands or call tools. Reply with QUEUE_NATIVE_STARTED.",
		})
		.run();
	const bridge = join(root, "bridge.cjs");
	writeFileSync(bridge, HOOK_BRIDGE_SOURCE);
	mergeClaudeHooks(
		join(root, "settings.json"),
		`ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(bridge)}`
	);
	const realBinary =
		process.env[provider === "codex" ? "SS_QUEUE_CODEX_BIN" : "SS_QUEUE_CLAUDE_BIN"]!;
	const wrapperArgs: string[] = [];
	if (provider === "claude")
		wrapperArgs.push(
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
			"--disable-slash-commands"
		);
	else {
		const sourceHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
		const cfg = TOML.parse(readFileSync(join(sourceHome, "config.toml"), "utf8"));
		assert(!cfg["model_provider"], "Native fixture requires the standard Codex provider");
		assert(
			!cfg["cli_auth_credentials_store"] || cfg["cli_auth_credentials_store"] === "file",
			"Native fixture requires existing file-backed Codex authentication"
		);
		assert(existsSync(join(sourceHome, "auth.json")), "Log in to Codex before the native test");
		const home = join(root, "codex-home");
		mkdirSync(home, { mode: 0o700 });
		symlinkSync(join(sourceHome, "auth.json"), join(home, "auth.json"));
		const model = cfg["model"];
		writeFileSync(join(home, "config.toml"), TOML.stringify(model ? { model } : {}), {
			mode: 0o600,
		});
		process.env["CODEX_HOME"] = home;
		const command = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(bridge)}`;
		const events = Object.fromEntries(
			["SessionStart", "UserPromptSubmit", "Stop", "PermissionRequest"].map((event) => [
				event,
				[{ hooks: [{ type: "command", command, timeout: 35 }] }],
			])
		);
		const state = await codexHookTrust(realBinary, cwd, events, process.env, command);
		wrapperArgs.push(
			"-c",
			`hooks=${TOML.stringify.value({ ...events, state })}`,
			"-c",
			`projects=${TOML.stringify.value({ [cwd]: { trust_level: "trusted" } })}`,
			"-c",
			"mcp_servers={}",
			"--ask-for-approval",
			"on-request",
			"--sandbox",
			"read-only",
			"--no-alt-screen"
		);
	}
	const bin = join(root, "bin");
	mkdirSync(bin);
	// Test-only adapter keeps every production argument, adding restrictive isolated configuration.
	writeFileSync(
		join(bin, provider),
		`#!/bin/sh\n${provider === "codex" ? '[ "$1" = "--no-daemon" ] || exit 97\n' : ""}exec ${[realBinary, ...wrapperArgs].map(quote).join(" ")} "$@"\n`,
		{ mode: 0o700 }
	);
	process.env["PATH"] = `${bin}:${process.env["PATH"]}`;
	process.env["AGENT_NOTIFY_AGENT"] = provider;
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
			inspectForeground: async () => ({ status: "unknown", error: "No sleep in this fixture" }),
			terminateForeground: async () => ({ ok: false, error: "No sleep in this fixture" }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	setAgentSessionManager(manager);
	setTaskRegistry(new TaskRegistry());
	agentRegistry.set("claude", claudeConfig);
	agentRegistry.set("codex", codexConfig);
	listener.onEvent((event) => {
		const accepted = manager.handleAgentEvent(event);
		trace.push({
			event: event.rawEvent,
			provider: event.agent,
			terminal: event.terminalId,
			conversation: event.providerSessionId,
			accepted: !!accepted,
			cwd: event.cwd,
			launchId: event.launchId,
		});
	});
	await listener.start();
	setAgentNotifyPort(listener.getPort());
	setAgentNotifyToken(token);
	getDb()
		.insert(terminalSessions)
		.values({
			id: "sibling",
			workspaceId: "workspace",
			title: "Unrelated managed shell",
			cwd,
			sortOrder: 0,
			updatedAt: now,
		})
		.run();
	manager.registerManagedSession({
		terminalId: "sibling",
		workspaceId: "workspace",
		provider,
		providerSessionId: oldConversation,
		skipPermissions: false,
	});
	await daemon.create(
		"sibling",
		cwd,
		() => {},
		() => {}
	);
	const siblingPid = (await daemon.listSessionsStrict()).find((s) => s.id === "sibling")!.pid;
	setupTerminalIPC(daemon, manager);
	win = new BrowserWindow({
		show: false,
		width: 900,
		height: 500,
		webPreferences: {
			preload: join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	win.webContents.on("before-input-event", (event) => event.preventDefault());
	const url = pathToFileURL(join(root, "index.html")).href;
	rendererTrust.register(win.webContents.id, url);
	registerConfirmBridge(() => win);
	await win.loadURL(url);
	win.show();
	app.focus({ steal: true });
	win.focus();
	const queue = new ActivityQueueService();
	let itemId: string;
	let revision: number;
	let prepared:
		| Awaited<ReturnType<typeof fixProjectHook>>
		| Awaited<ReturnType<typeof solveQueuePRFeedback>>;
	if (scenario === "hook") {
		const configRoot = join(root, "hook-project");
		mkdirSync(join(configRoot, ".superiorswarm"), { recursive: true });
		writeFileSync(
			join(configRoot, ".superiorswarm/queue.yml"),
			'hooks: [{id: check, title: Check, run: "true"}]'
		);
		process.env["SS_QUEUE_FIXTURE_HOOK_CONFIG_ROOT"] = configRoot;
		const config = readQueueHookConfig(cwd);
		setProjectHooksEnabled(true);
		trustProjectHooks("project", config.hash);
		reconcileProjectHookOutput(
			{ id: "project", name: "Native queue fixture" },
			config,
			{ id: "check", title: "Synthetic check" },
			[
				{
					key: "native",
					title: "Native launch probe",
					why: "Verify the exact callback",
					fixPrompt: "Reply with exactly QUEUE_NATIVE_STARTED. Do not use tools or change files.",
				},
			]
		);
		itemId = projectHookSourceId("project", "check", "native");
		revision = queue.read(itemId)!.revision;
		step = "production hook action preparation";
		prepared = await fixProjectHook({ id: itemId, revision, workspaceId: "workspace" });
	} else {
		saveAuth({ accessToken: "synthetic-not-a-token", accountId: "fixture" });
		registerGitProvider({ name: "github", isConnected: () => true } as GitProvider);
		Object.defineProperty(globalThis, "fetch", {
			value: async (input: RequestInfo | URL, init?: RequestInit) => {
				const path = String(input);
				const method = init?.method ?? "GET";
				if (path.endsWith("/graphql") && method === "POST")
					return new Response(
						JSON.stringify({
							data: {
								repository: {
									pullRequest: {
										reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
									},
								},
							},
						}),
						{ status: 200 }
					);
				assert.equal(method, "GET", "No external mutations in fixture");
				if (path.includes("/pulls/7/reviews"))
					return new Response(
						JSON.stringify([
							{
								id: 42,
								body: "Do not change files; reply QUEUE_NATIVE_STARTED.",
								user: { id: 42, login: "FixtureReviewer" },
								submitted_at: new Date().toISOString(),
								state: "CHANGES_REQUESTED",
							},
						]),
						{ status: 200 }
					);
				if (path.includes("/issues/7/comments")) return new Response("[]", { status: 200 });
				throw Error("Unexpected external request");
			},
		});
		registerExternalQueueAdapter(["pr-feedback"], {
			describe: describePRQueueItem,
			current: isPRQueueItemCurrent,
		});
		itemId = "fixture-pr-feedback";
		queue.observe({
			sourceId: itemId,
			sourceType: "pr",
			fingerprint: "native",
			snapshot: {},
			observedAt: Date.now(),
			candidate: {
				kind: "pr-feedback",
				title: "Native feedback probe",
				summary: "Synthetic reviewer feedback",
				projectId: "project",
				projectName: "Native queue fixture",
				occurredAt: Date.now(),
				reasons: [{ code: "review:42", label: "Do not change files; reply QUEUE_NATIVE_STARTED." }],
				target: {
					type: "pr",
					provider: "github",
					accountId: "fixture",
					host: "github.com",
					owner: "fixture",
					repo: "repo",
					number: 7,
				},
			},
		});
		revision = queue.read(itemId)!.revision;
		step = "production PR action preparation";
		prepared = await solveQueuePRFeedback({ id: itemId, revision });
		const comment = getDb().select().from(prComments).get();
		assert(comment?.body.includes("FixtureReviewer"));
		assert(comment?.body.includes("review:42"));
	}
	assert.equal(prepared.status, "prepared");
	if (prepared.status !== "prepared") throw Error("Launch cancelled");
	const launch = prepared.launch;
	launchDir = dirname(launch.scriptPath);
	const script = readFileSync(launch.scriptPath, "utf8");
	assert(!script.includes("dangerously"));
	assert(!script.includes("approval_policy=never"));
	if (provider === "codex") assert.equal(script.match(/codex --no-daemon/g)?.length, 1);
	step = "renderer create-before-write";
	await win.webContents.executeJavaScript(
		`window.nativeLaunchProbe.start(${JSON.stringify(launch)})`
	);
	assert.deepEqual(await win.webContents.executeJavaScript("window.nativeLaunchProbe.order"), [
		"create:start",
		"create:complete",
		"write",
	]);
	step = "actual native provider callback";
	await until(() =>
		trace.some(
			(event) =>
				event.terminal === launch.terminalId && event.accepted && event.event === "UserPromptSubmit"
		)
	);
	const prompt = trace.find(
		(event) =>
			event.terminal === launch.terminalId && event.accepted && event.event === "UserPromptSubmit"
	)!;
	assert(prompt.conversation && prompt.conversation !== oldConversation);
	assert.equal(prompt.cwd, cwd);
	assert.equal(prompt.provider, provider);
	assert.equal(manager.getSession("sibling")?.managed, true);
	assert.equal(
		getDb().select().from(workspaces).where(eq(workspaces.id, "workspace")).get()?.cliSessionId,
		oldConversation
	);
	assert.equal(
		(await daemon.listSessionsStrict()).find((s) => s.id === "sibling")?.pid,
		siblingPid
	);
	assert.notEqual(queue.read(itemId!)?.acknowledgedRevision, revision!);
	const live = (await daemon.listSessionsStrict()).find((s) => s.id === launch.terminalId);
	assert(live);
	const identity = readTerminalProcessIdentity(live.pid);
	assert(identity);
	const foreground = await new PosixAgentProcessController(daemon).inspectForeground(
		launch.terminalId,
		provider
	);
	assert.equal(foreground.status, "agent", JSON.stringify(foreground));
	if (scenario === "hook") {
		assert(identity.executable.includes(provider), JSON.stringify(identity));
		const launchId = script.match(/AGENT_NOTIFY_LAUNCH_ID='([^']+)'/)?.[1];
		assert(
			launchId &&
				trace.some(
					(event) =>
						event.accepted && event.terminal === launch.terminalId && event.launchId === launchId
				)
		);
	}
	if (scenario === "hook") assert.equal(manager.getSession(launch.terminalId)?.managed, false);
	const terminalCount = (await daemon.listSessionsStrict()).length;
	queue.acknowledge({ id: itemId, revision });
	await assert.rejects(() =>
		scenario === "hook"
			? fixProjectHook({ id: itemId, revision, workspaceId: "workspace" })
			: solveQueuePRFeedback({ id: itemId, revision })
	);
	assert.equal((await daemon.listSessionsStrict()).length, terminalCount);
	await win.webContents
		.capturePage()
		.then((image) => writeFileSync(join(root, "native-launch.png"), image.toPNG()));
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify(
			{
				passed: true,
				provider,
				scenario,
				productionPreparedScript: true,
				rendererCreateBeforeWrite: true,
				actualNativeCallback: true,
				sameWorkspace: true,
				freshConversation: true,
				siblingManagedPreserved: true,
				sourceNotAcknowledged: true,
				postDoneLaunchRejected: true,
				adapter: "Test-only restrictive config/hooks flags; production argv retained",
				foregroundLeader: identity.executable,
				providerInForegroundGroup: foreground.status === "agent",
				trace,
			},
			null,
			2
		)
	);
}
async function finish(code: number) {
	if (win) {
		const text = await win.webContents
			.executeJavaScript('window.nativeLaunchProbe?.output() ?? ""')
			.catch(() => "unavailable");
		writeFileSync(join(root, "tui-output.txt"), text);
	}
	writeFileSync(join(root, "trace.json"), JSON.stringify({ step, trace }, null, 2));
	listener.stop();
	manager?.dispose();
	setAgentSessionManager(null);
	daemon.disconnect();
	socket?.close();
	ptys.disposeAll();
	rmSync(join(root, "codex-home/auth.json"), { force: true });
	if (launchDir && basename(launchDir).startsWith("ss-dispatch-"))
		rmSync(launchDir, { recursive: true, force: true });
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
