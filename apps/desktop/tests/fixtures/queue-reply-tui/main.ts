import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import {
	readTerminalProcessEnvironment,
	readTerminalProcessIdentity,
} from "../../../src/daemon/terminal-process-identity";
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
	agentMessages,
	projects,
	terminalSessions,
	workspaces,
} from "../../../src/main/db/schema";
import { PosixAgentProcessController } from "../../../src/main/services/agent-process-controller";
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
	launchId?: string;
	turnId?: string;
}[] = [];
const resumeScenario = process.env["SS_QUEUE_RESUME_TUI"] === "1";
const answerScenario = process.env["SS_QUEUE_ANSWER_TUI"] === "1";
const emptyScenario = process.env["SS_QUEUE_EMPTY_CHAT_TUI"] === "1";
let fixtureCodexHome: string | undefined;
let output = "";
let viewOutput: string | null = null;
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
		processController: resumeScenario
			? new PosixAgentProcessController(daemon)
			: {
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
			launchId: event.launchId,
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
	if (provider === "codex") {
		// An isolated home avoids the native startup gate for unrelated changed user hooks,
		// even when those hooks are disabled. Reuse authentication without copying secrets.
		const userCodexHome = process.env["CODEX_HOME"] || join(homedir(), ".codex");
		const configured = TOML.parse(readFileSync(join(userCodexHome, "config.toml"), "utf8"));
		assert(!configured["model_provider"], "Native fixture requires the standard Codex provider");
		assert(
			!configured["cli_auth_credentials_store"] ||
				configured["cli_auth_credentials_store"] === "file",
			"Native fixture requires existing file-backed Codex authentication"
		);
		assert(existsSync(join(userCodexHome, "auth.json")), "Log in to Codex before the native test");
		fixtureCodexHome = join(root, "codex-home");
		mkdirSync(fixtureCodexHome, { mode: 0o700 });
		symlinkSync(join(userCodexHome, "auth.json"), join(fixtureCodexHome, "auth.json"));
		const selected: ReturnType<typeof TOML.parse> = {};
		for (const key of ["model", "model_context_window", "model_reasoning_effort", "service_tier"]) {
			const value = configured[key];
			if (value !== undefined) selected[key] = value;
		}
		writeFileSync(join(fixtureCodexHome, "config.toml"), TOML.stringify(selected), { mode: 0o600 });
	}
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
		...(fixtureCodexHome ? { CODEX_HOME: fixtureCodexHome } : {}),
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
			if (viewOutput !== null) viewOutput = (viewOutput + data).slice(-100000);
			writeFileSync(join(root, "tui-output.txt"), output);
			if (data.includes("\x1b[6n")) daemon.write(terminalId, "\x1b[1;1R");
		},
		() => {},
		env
	);
	let sleepingRootPid: number | undefined;
	let siblingPid: number | undefined;
	if (resumeScenario) {
		getDb()
			.insert(terminalSessions)
			.values({
				id: "untouched-sibling",
				workspaceId: "workspace",
				title: "Unrelated shell",
				cwd,
				sortOrder: 1,
				updatedAt: now,
			})
			.run();
		await daemon.create(
			"untouched-sibling",
			cwd,
			() => {},
			() => {}
		);
		siblingPid = (await daemon.listSessionsStrict()).find(
			(row) => row.id === "untouched-sibling"
		)?.pid;
		assert.ok(siblingPid);
	}
	const initialConversationId = randomUUID();

	const launchId = randomUUID();
	const environmentProbe = randomUUID();
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
			initialConversationId,
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
			{ ...env, AGENT_NOTIFY_LAUNCH_ID: launchId, SS_RESUME_POLICY_PROBE: environmentProbe },
			hookCommand
		);

		args = [
			"--no-daemon",
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
	const policyArgs = provider === "claude" ? args.slice(0, -3) : args.slice(0, -1);
	if (resumeScenario || emptyScenario) {
		const registration: Parameters<AgentSessionManager["registerManagedSession"]>[0] = {
			terminalId,
			workspaceId: "workspace",
			provider,
			providerSessionId: provider === "claude" ? initialConversationId : null,
			skipPermissions: false,
			queueLaunchId: launchId,
			queueLaunch: { provider, args: policyArgs, initialPrompt: !emptyScenario },
		};
		if (emptyScenario) manager.registerOwnedSession(registration);
		else manager.registerManagedSession(registration);
	}
	if (emptyScenario) args = args.slice(0, -1);
	const bin = process.env[provider === "claude" ? "SS_QUEUE_CLAUDE_BIN" : "SS_QUEUE_CODEX_BIN"]!;
	writeFileSync(
		join(root, "launch.sh"),
		`#!/bin/sh\nSS_RESUME_POLICY_PROBE=${quote(environmentProbe)} AGENT_NOTIFY_LAUNCH_ID=${quote(launchId)} exec ${[bin, ...args].map(quote).join(" ")}\n`,
		{ mode: 0o700 }
	);
	daemon.write(terminalId, `/bin/sh ${quote(join(root, "launch.sh"))}\r`);
	if (emptyScenario) {
		step = "empty app-owned chat ready for first manual input";
		await until(async () => {
			const live = (await daemon.listSessionsStrict()).find((row) => row.id === terminalId);
			if (!live) return false;
			const identity = readTerminalProcessIdentity(live.pid);
			return (
				!!identity &&
				(identity.executable.split("/").at(-1) === provider ||
					(provider === "claude" && identity.executable.includes("/claude/versions/"))) &&
				(provider === "codex" ? output.includes("Ask Codex") : output.includes("❯"))
			);
		});
		assert.equal(
			trace.some((event) => event.accepted && event.event === "UserPromptSubmit"),
			false
		);
		daemon.write(terminalId, `\x1b[200~${prompt}\x1b[201~\r`);
	}
	step = "actual initial TUI turn";
	await until(async () =>
		(await listWorkspaceQueue()).items.some(
			(i) =>
				i.target.type === "terminal" &&
				i.target.terminalId === terminalId &&
				i.situation === "agent-done"
		)
	);
	let item = (await listWorkspaceQueue()).items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === terminalId
	)!;
	if (answerScenario) {
		// Controlled question seed, bound to the actual provider conversation. Delivery below is real.
		const questionId = randomUUID();
		getDb()
			.insert(agentMessages)
			.values({
				id: questionId,
				projectId: "project",
				fromWorkspaceId: "workspace",
				toWorkspaceId: null,
				kind: "question",
				content: "What should I reply with next?",
				reporter: item.target,
				createdAt: new Date(),
			})
			.run();
		const question = (await listWorkspaceQueue()).items.find(
			(row) => row.question?.messageId === questionId
		);
		assert.ok(question);
		item = question;
	}
	if (resumeScenario) {
		step = "authentic app launch registered original policy";
		assert(trace.some((event) => event.accepted && event.launchId === launchId));
		await until(async () => {
			const session = manager.getSession(terminalId);
			return (
				!!session?.providerSessionId &&
				!!(await daemon.prepareQueueSleep(terminalId, provider, session.providerSessionId))
			);
		}, 5000);
		const initialTarget = JSON.stringify(item.target);
		const originalRevision = item.revision;
		step = "hibernate real provider";
		assert.equal((await manager.sleepNow(terminalId)).state, "hibernated");
		sleepingRootPid = (await daemon.listSessionsStrict()).find((row) => row.id === terminalId)?.pid;
		assert.ok(sleepingRootPid);
		const parkedIdentity = readTerminalProcessIdentity(sleepingRootPid);
		if (parkedIdentity)
			assert.notEqual(
				readTerminalProcessEnvironment(parkedIdentity)?.["SS_RESUME_POLICY_PROBE"],
				environmentProbe,
				"Provider-only environment must not leak into parked shell"
			);
		const sleeping = (await listWorkspaceQueue()).items.find((row) => row.id === item.id);
		assert.equal(JSON.stringify(sleeping?.target), initialTarget);
		assert.equal(
			sleeping?.revision,
			originalRevision,
			"Sleeping alone cannot consume or revise attention"
		);
	}
	const caller = activityQueueRouter.createCaller({});
	const capability = answerScenario
		? await caller.workspaceAnswerContinuationCapability({
				...item,
				questionId: item.question!.messageId,
			})
		: await workspaceReplyCapability(item);
	assert.equal(capability.status, "available", JSON.stringify(capability));
	if (resumeScenario) assert.equal(capability.status === "available" && capability.mode, "resume");
	await win.webContents.executeJavaScript(
		`window.queueReplyProbe.select(${JSON.stringify(item.id)}); window.queueReplyProbe.refresh()`
	);
	const composerSelector = answerScenario
		? '[aria-label="Reply to this question"] textarea'
		: '[aria-label="Reply to conversation"] textarea';
	const sendLabel = answerScenario ? "Send & continue" : "Send reply";
	step = "rendered reply control";
	await until(() =>
		win.webContents.executeJavaScript(
			`!!document.querySelector(${JSON.stringify(composerSelector)})`
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
		`(()=>{const el=document.querySelector(${JSON.stringify(composerSelector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(content)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`
	);
	await until(() =>
		win.webContents.executeJavaScript(
			`[...document.querySelectorAll("button")].some(b=>b.textContent===${JSON.stringify(sendLabel)}&&!b.disabled)`
		)
	);
	step = "Queue reply to actual TUI";
	await win.webContents.executeJavaScript(
		`[...document.querySelectorAll("button")].find(b=>b.textContent===${JSON.stringify(sendLabel)}).click()`
	);
	await until(() =>
		getDb()
			.select()
			.from(activityQueueDeliveries)
			.all()
			.some((r) => r.state === "admitted")
	);
	const delivery = getDb().select().from(activityQueueDeliveries).all()[0]!;
	const retryOriginal = async () => {
		const input = {
			id: item.id,
			revision: item.revision,
			members: item.members,
			requestId: delivery.requestId,
			content,
		};
		return answerScenario
			? (
					await caller.workspaceAnswerAndContinue({
						...input,
						questionId: item.question!.messageId,
						answerId: delivery.answerBinding?.answerId,
					})
				).continuation
			: await workspaceReply(input);
	};
	assert(["admitted", "received"].includes((await retryOriginal()).status));
	step = "real provider followup receipt";
	await until(() =>
		trace.some(
			(event) =>
				event.event === "Stop" &&
				event.accepted &&
				event.evidence?.some((value) => /^QUEUE_TUI_FOLLOWUP[.!]?$/.test(value.text.trim()))
		)
	);
	assert.equal((await retryOriginal()).status, "received");
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
	if (answerScenario) {
		assert.ok(delivery.answerBinding);
		const answer = getDb()
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.id, delivery.answerBinding.answerId))
			.get();
		assert.equal(answer?.content, content);
		assert.ok(answer?.retrievedAt);
		assert.equal(
			(await listWorkspaceQueue()).items.some((row) => row.id === item.id),
			false,
			"Accepted answer resolves only its exact question"
		);
	}
	if (resumeScenario && !answerScenario) {
		const resumedRoot = (await daemon.listSessionsStrict()).find((row) => row.id === terminalId);
		assert.ok(resumedRoot);
		const resumedIdentity = readTerminalProcessIdentity(resumedRoot.pid);
		assert.ok(resumedIdentity);
		assert.equal(
			readTerminalProcessEnvironment(resumedIdentity)?.["SS_RESUME_POLICY_PROBE"],
			environmentProbe,
			"Resume must preserve original provider exec environment"
		);
		assert.notEqual(
			resumedRoot.pid,
			sleepingRootPid,
			"Queue resume must use structured process replacement, not shell text"
		);
		assert.equal(
			(await daemon.listSessionsStrict()).find((row) => row.id === "untouched-sibling")?.pid,
			siblingPid
		);
		step = "second real hibernation";
		const next = (await listWorkspaceQueue()).items.find(
			(row) => row.target.type === "terminal" && row.target.terminalId === terminalId
		);
		assert.ok(next);
		assert.equal((await manager.sleepNow(terminalId)).state, "hibernated");
		step = "second structured resume";
		const secondCapability = await workspaceReplyCapability(next);
		assert.equal(
			secondCapability.status,
			"available",
			JSON.stringify({
				secondCapability,
				session: manager.getSession(terminalId),
				items: (await listWorkspaceQueue()).items.map((row) => ({
					id: row.id,
					revision: row.revision,
				})),
			})
		);
		const second = await workspaceReply({
			...next,
			requestId: randomUUID(),
			content: "Reply with exactly QUEUE_TUI_RESUME_AGAIN. Do not use tools or change files.",
		});
		assert.ok(second.status === "admitted" || second.status === "received", JSON.stringify(second));
		await until(() =>
			trace.some(
				(event) =>
					event.accepted &&
					event.event === "Stop" &&
					event.evidence?.some((e) => e.text.includes("QUEUE_TUI_RESUME_AGAIN"))
			)
		);
		assert.equal(
			manager.getSession(terminalId)?.providerSessionId,
			item.target.type === "terminal" ? item.target.providerSessionId : null
		);
		assert.equal(
			(await daemon.listSessionsStrict()).find((row) => row.id === "untouched-sibling")?.pid,
			siblingPid
		);
		step = "view-only structured wake";
		const beforeView = (await listWorkspaceQueue()).items.find(
			(row) => row.target.type === "terminal" && row.target.terminalId === terminalId
		);
		assert.ok(beforeView);
		await manager.sleepNow(terminalId);
		const eventOffset = trace.length;
		viewOutput = "";
		await manager.wake(terminalId);
		await until(async () => {
			const live = (await daemon.listSessionsStrict()).find((row) => row.id === terminalId);
			if (!live) return false;
			const identity = readTerminalProcessIdentity(live.pid);
			return (
				!!identity &&
				(identity.name === provider ||
					(provider === "claude" && identity.executable.includes("/claude/versions/"))) &&
				(provider === "claude"
					? trace
							.slice(eventOffset)
							.some((event) => event.accepted && event.event === "SessionStart")
					: (viewOutput ?? "").includes("QUEUE_TUI_RESUME_AGAIN"))
			);
		});
		const afterView = (await listWorkspaceQueue()).items.find((row) => row.id === beforeView.id);
		assert.equal(
			afterView?.revision,
			beforeView.revision,
			"View-only wake must preserve attention"
		);
		assert.equal(
			trace
				.slice(eventOffset)
				.some((event) => event.accepted && event.event === "UserPromptSubmit"),
			false,
			"View-only wake must not manufacture a new prompt"
		);
		step = "manual followup after view-only wake";
		const manual = "Reply with exactly QUEUE_TUI_VIEW_FOLLOWUP. Do not use tools or change files.";
		daemon.write(terminalId, `\x1b[200~${manual}\x1b[201~\r`);
		await until(() =>
			trace
				.slice(eventOffset)
				.some(
					(event) =>
						event.accepted &&
						event.event === "Stop" &&
						event.evidence?.some((e) => e.text.includes("QUEUE_TUI_VIEW_FOLLOWUP"))
				)
		);
		assert.equal(
			manager.getSession(terminalId)?.providerSessionId,
			item.target.type === "terminal" ? item.target.providerSessionId : null
		);
	}
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
				resumeCycles: resumeScenario ? (answerScenario ? 1 : 2) : 0,
				savedAnswerContinuation: answerScenario,
				appLaunchNonceVerified: resumeScenario || emptyScenario,
				emptyOwnedChat: emptyScenario,
				questionOrigin: answerScenario ? "controlled seed bound to actual provider" : undefined,
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
	if (fixtureCodexHome) rmSync(join(fixtureCodexHome, "auth.json"), { force: true });
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
