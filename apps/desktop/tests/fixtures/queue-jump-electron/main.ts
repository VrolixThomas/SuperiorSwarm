import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app, session } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { setEventsDir } from "../../../src/main/control-plane/orchestrator-event-sink";
import { getDb } from "../../../src/main/db";
import {
	githubBranchPrs,
	projects,
	terminalSessions,
	ticketBranchLinks,
	ticketCache,
	trackedPrs,
	workspaces,
} from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { sendMessage, setStatus } from "../../../src/main/services/workspace-service";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";

import { checkJumpInteractions } from "./interactions";
function requireEnvironment(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing isolated setting: ${name}`);
	return value;
}
const root = requireEnvironment("SS_QUEUE_FIXTURE_ROOT");
const migrations = requireEnvironment("SS_QUEUE_MIGRATIONS");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
const ptys = new PtyManager();
const socket = join(root, "daemon.sock");
const server = new SocketServer(ptys, { flush: () => [] } as unknown as ScrollbackStore, socket);
const daemon = new DaemonClient(socket, join(root, "pid"), join(root, "daemon.log"));
let win: BrowserWindow | undefined;
let manager: AgentSessionManager | undefined;
const step = "start";
async function run() {
	await app.whenReady();
	setEventsDir(join(root, "events"));
	server.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	const dbPath = getDb().$client.name;
	if (!dbPath.startsWith(root)) throw Error(`Fixture DB escaped isolation: ${dbPath}`);
	migrate(getDb(), { migrationsFolder: migrations });
	console.log(
		"ISOLATED_DB",
		dbPath,
		"QUEUE_TABLE",
		getDb()
			.$client.prepare("SELECT name FROM sqlite_master WHERE name = 'activity_queue_sources'")
			.all()
	);
	const { appRouter } = await import("../../../src/main/trpc/routers");
	const now = new Date();
	for (const [id, name] of [
		["p1", "SuperiorSwarm"],
		["p2", "Client portal"],
	] as const) {
		mkdirSync(join(root, id));
		getDb()
			.insert(projects)
			.values({ id, name, repoPath: join(root, id), createdAt: now, updatedAt: now })
			.run();
	}
	for (let i = 0; i < 29; i++) {
		const folder = i < 8;
		const id = folder ? `folder-${i}` : `repo-${i}`;
		getDb()
			.insert(projects)
			.values({
				id,
				name: `${folder ? "Folder" : "Repository"} ${i + 1}`,
				kind: folder ? "folder" : "repo",
				repoPath: join(root, id),
				createdAt: now,
				updatedAt: now,
			})
			.run();
		if (folder)
			getDb()
				.insert(workspaces)
				.values({
					id: `${id}-default`,
					projectId: id,
					type: "folder",
					name: "default",
					createdAt: now,
					updatedAt: now,
				})
				.run();
	}
	for (let i = 0; i < 30; i++)
		getDb()
			.insert(workspaces)
			.values({
				id: `extra-${i}`,
				projectId: "p1",
				type: "branch",
				name: `Workspace ${i + 1}`,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	const names = [
		"Choose the workspace restore behavior",
		"Finish the activity queue redesign",
		"Check the callback permissions",
	];
	for (const [i, id] of ["w1", "w2", "w3"].entries()) {
		getDb()
			.insert(workspaces)
			.values({
				id,
				projectId: i === 2 ? "p2" : "p1",
				type: "branch",
				name: names[i] ?? id,
				folderPath: root,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		getDb()
			.insert(terminalSessions)
			.values({
				id: `terminal-${id}`,
				workspaceId: id,
				cwd: root,
				title: i === 2 ? "Review workspace callback permissions" : (names[i] ?? id),
				sortOrder: i,
				updatedAt: now,
			})
			.run();
		await daemon.create(
			`terminal-${id}`,
			root,
			() => {},
			() => {},
			{ SHELL: "/bin/sh", HOME: root }
		);
	}
	manager = new AgentSessionManager({
		daemonClient: daemon,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	setAgentSessionManager(manager);
	for (const id of ["w1", "w2", "w3"])
		manager.registerManagedSession({
			terminalId: `terminal-${id}`,
			workspaceId: id,
			provider: "codex",
			providerSessionId: `provider-${id}`,
			skipPermissions: false,
		});
	for (const workspaceId of ["w1", "w2"]) {
		const terminalId = `sibling-${workspaceId}`;
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId,
				cwd: root,
				title: "Unrelated sibling",
				sortOrder: 9,
				updatedAt: now,
			})
			.run();
		await daemon.create(
			terminalId,
			root,
			() => {},
			() => {},
			{ SHELL: "/bin/sh", HOME: root }
		);
		manager.registerManagedSession({
			terminalId,
			workspaceId,
			provider: "codex",
			providerSessionId: `sibling-conversation-${workspaceId}`,
			skipPermissions: false,
		});
	}
	const { messageId: questionId } = await sendMessage(
		{ kind: "workspace", projectId: "p1", workspaceId: "w1", terminalId: "terminal-w1" },
		{
			kind: "question",
			content:
				"Should a reopened workspace restore the last active chat? The previous chat may still be waiting for your answer while another terminal is running. We can restore the last selected chat, or open the chat that currently needs input. This should also work when you return from a different project, close and reopen the application, or switch between an orchestrator and its workspaces. Which behavior should we use?",
		}
	);
	await setStatus(
		{ kind: "workspace", projectId: "p1", workspaceId: "w2", terminalId: "terminal-w2" },
		{ phase: "done", statusText: "Queue changes are ready for your review." }
	);
	manager.handleAgentEvent({
		agent: "codex",
		sessionId: "terminal-w2",
		terminalId: "terminal-w2",
		workspaceId: "w2",
		providerSessionId: "provider-w2",
		timestamp: Date.now(),
		producerTimestamp: Date.now(),
		cwd: root,
		rawEvent: "Stop",
		turnId: "report-turn",
		alert: "task-complete",
		evidence: [
			{
				kind: "reply",
				text: "Report turn ended; the isolated checks passed.",
				provider: "codex",
				rawEvent: "Stop",
				sourceField: "last_assistant_message",
				truncated: false,
				redacted: false,
			},
		],
	});
	manager.handleAgentEvent({
		agent: "codex",
		sessionId: "terminal-w3",
		terminalId: "terminal-w3",
		workspaceId: "w3",
		providerSessionId: "provider-w3",
		timestamp: Date.now(),
		producerTimestamp: Date.now(),
		cwd: root,
		rawEvent: "PermissionRequest",
		turnId: "permission",
		evidence: [
			{
				kind: "permission",
				text: "Allow reading the isolated fixture only?",
				provider: "codex",
				rawEvent: "PermissionRequest",
				sourceField: "permission_prompt",
				truncated: false,
				redacted: false,
			},
		],
		permission: { requestId: "native-request", outcome: "pending" },
		alert: "needs-input",
	});
	// An external candidate is deliberately present in storage; it must never reach the new UI or badge.
	new ActivityQueueService().observe({
		sourceId: "pr:hidden",
		sourceType: "pr",
		snapshot: {},
		fingerprint: "external",
		observedAt: Date.now(),
		candidate: {
			kind: "pr-review",
			title: "EXTERNAL PR MUST NOT APPEAR",
			summary: "External",
			occurredAt: Date.now(),
			reasons: [],
			target: { type: "pr", provider: "github", owner: "owner", repo: "repo", number: 7 },
		},
	});

	const ticketId = "11111111-1111-4111-8111-111111111111";
	getDb()
		.insert(ticketBranchLinks)
		.values({
			id: "native-ticket-link",
			workspaceId: "w1",
			provider: "linear",
			ticketId,
			createdAt: now,
		})
		.run();
	getDb()
		.insert(ticketCache)
		.values({
			id: `linear:${ticketId}`,
			provider: "linear",
			groupId: "native-team",
			updatedAt: now,
			data: JSON.stringify({
				id: ticketId,
				identifier: "SUP-46",
				title: "Jump to exact pending work",
				url: "https://linear.app/superiorset/issue/SUP-46/queue",
			}),
		})
		.run();
	getDb()
		.insert(githubBranchPrs)
		.values({
			id: "native-pr-link",
			workspaceId: "w1",
			prRepoOwner: "fixture",
			prRepoName: "isolated",
			prNumber: 46,
			createdAt: now,
		})
		.run();
	getDb()
		.insert(trackedPrs)
		.values({
			provider: "github",
			identifier: "fixture/isolated#46",
			repoOwner: "fixture",
			repoName: "isolated",
			number: 46,
			title: "Exact queue navigation",
			state: "open",
			role: "author",
			firstSeenAt: now,
			lastSeenAt: now,
			updatedAt: now,
		})
		.run();
	setupTRPCIPC(appRouter);
	let releaseInventory = () => {};
	const inventoryGate = new Promise<void>((resolve) => {
		releaseInventory = resolve;
	});
	const readInventory = daemon.listSessionsStrict.bind(daemon);
	daemon.listSessionsStrict = async () => {
		await inventoryGate;
		return readInventory();
	};

	session.defaultSession.webRequest.onBeforeRequest((details, done) =>
		done({ cancel: !details.url.startsWith("file://") && !details.url.startsWith("devtools://") })
	);
	win = new BrowserWindow({
		show: false,
		width: 1440,
		height: 900,
		webPreferences: {
			backgroundThrottling: false,
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
	app.focus({ steal: true });
	win.focus();
	contents.focus();

	releaseInventory();
	daemon.listSessionsStrict = readInventory;
	await checkJumpInteractions(win, root, daemon, manager, questionId);
}
function finish(code: number) {
	manager?.dispose();
	setAgentSessionManager(null);
	daemon.disconnect();
	setDaemonClient(null);
	server.close();
	ptys.disposeAll();
	win?.destroy();
	app.exit(code);
}
run()
	.then(() => finish(0))
	.catch((error) => {
		console.error("QUEUE_JUMP_FAILURE", step, error);
		finish(1);
	});
