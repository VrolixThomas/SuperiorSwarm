import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, app, ipcMain } from "electron";
import { registerReviewPathTools } from "../../../mcp-standalone/review-path.mjs";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { startControlPlane } from "../../../src/main/control-plane";
import { closeDb, getDb, initializeDatabase } from "../../../src/main/db";
import * as schema from "../../../src/main/db/schema";
import { registerGitProvider } from "../../../src/main/providers/git-provider";
import type { GitProvider } from "../../../src/main/providers/types";
import { initializeReviewPathRuntime } from "../../../src/main/review-path/runtime";
import { getReviewPathStorage } from "../../../src/main/review-path/service";
import { setTaskRegistry } from "../../../src/main/services/task-registry-handle";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";

const originalLog = console.log;
console.log = (...args) =>
	originalLog(
		...args.map((value) =>
			typeof value === "string" ? value.replace(/taskToken=[^ ]+/g, "taskToken=[REDACTED]") : value
		)
	);
const root = process.env["SS_LIFECYCLE_ROOT"];
if (!root) throw Error("Disposable fixture root required");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setPath("crashDumps", join(root, "profile"));
app.setAppLogsPath(join(root, "profile", "logs"));
app.disableHardwareAcceleration();
app.dock?.hide();
const manager = new PtyManager();
const socket = new SocketServer(
	manager,
	{ flush: () => [] } as unknown as ScrollbackStore,
	join(root, "daemon.sock")
);
const client = new DaemonClient(
	join(root, "daemon.sock"),
	join(root, "pid"),
	join(root, "daemon.log")
);
let head = process.env["SS_LIFECYCLE_HEAD"]!;
let releaseInventory: (() => void) | undefined;
let inventoryEntered = false;
const originalInventory = client.listSessionsStrict.bind(client);
client.listSessionsStrict = async () => {
	if (releaseInventory) {
		inventoryEntered = true;
		await inventoryGate;
	}
	return originalInventory();
};
let inventoryGate: Promise<void>;
let providerFailure = false;
let providerEntered = false;
let providerReadsRemaining = 0;
let releaseProvider: (() => void) | undefined;
let providerGate: Promise<void>;
let createEntered = false;
let releaseCreate: (() => void) | undefined;
let createGate: Promise<void>;
const originalCreate = client.create.bind(client);
client.create = async (...args: Parameters<typeof client.create>) => {
	await originalCreate(...args);
	if (releaseCreate) {
		createEntered = true;
		await createGate;
	}
};
const writes: string[] = [];
const originalWrite = client.write.bind(client);
client.write = (id, data) => {
	writes.push(id);
	return originalWrite(id, data);
};
async function run() {
	await app.whenReady();
	initializeDatabase();
	let db = getDb();
	const now = new Date();
	db.insert(schema.projects)
		.values({
			id: "p",
			name: "Fixture",
			repoPath: join(root!, "repo"),
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.projects)
		.values({
			id: "p2",
			name: "Fixture 2",
			repoPath: join(root!, "repo2"),
			createdAt: now,
			updatedAt: now,
		})
		.run();
	for (const [id, provider] of [
		["w", "github"],
		["w2", "github"],
		["bb", "bitbucket"],
	] as const)
		db.insert(schema.workspaces)
			.values({
				id,
				projectId: id === "w2" ? "p2" : "p",
				name: id,
				type: "review",
				prProvider: provider,
				prIdentifier: "o/r#1",
				createdAt: now,
				updatedAt: now,
			})
			.run();
	db.insert(schema.workspaces)
		.values({
			id: "restart",
			projectId: "p",
			name: "Restart",
			type: "review",
			prProvider: "github",
			prIdentifier: "o/r#2",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.aiReviewSettings)
		.values({ id: "default", cliPreset: "codex", skipPermissions: 0, updatedAt: now })
		.run();
	socket.listen();
	await client.connect();
	setDaemonClient(client);
	setupTerminalIPC(client);
	for (const name of ["github", "bitbucket"] as const)
		registerGitProvider({
			name,
			getPRDetails: async () => {
				if (providerFailure) throw Error("Fixture provider temporarily unavailable");
				const details = {
					title: "Disposable PR",
					author: "fixture",
					sourceBranch: "feature",
					targetBranch: "main",
					headCommitOid: head,
					files: [
						{ path: "a.ts", additions: 1, deletions: 0 },
						{ path: "b.test.ts", additions: 1, deletions: 0 },
					],
					filesComplete: true,
					state: "closed",
				};
				if (releaseProvider && --providerReadsRemaining === 0) {
					providerEntered = true;
					await providerGate;
				}
				return details;
			},
		} as unknown as GitProvider);
	const restartIdentity = {
		workspaceId: "restart",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 2,
		headSha: head,
	};
	const persisted = getReviewPathStorage();
	const surviving = persisted.begin(
		restartIdentity,
		{ id: "codex", label: "Codex" },
		["a.ts", "b.test.ts"],
		{ auto: true }
	);
	const survivorId = `review-path:${surviving.id}:${surviving.version}`;
	persisted.attachTerminal(surviving, survivorId);
	await client.create(
		survivorId,
		join(root!, "repo"),
		() => {},
		() => {}
	);
	const missing = persisted.enqueueQuestion(restartIdentity, {
		id: "restart-question",
		text: "Interrupted question",
	});
	persisted.attachTerminal(missing.run, `review-path:${missing.run.id}:${missing.run.version}`);
	const oldCapability = persisted.grantCapability(surviving);
	// Close/reopen disk storage while the native daemon PTY survives; rotate control plane afterwards.
	closeDb();
	initializeDatabase();
	db = getDb();
	const server = await startControlPlane({
		confirm: async () => {
			throw Error("No confirmations allowed");
		},
		spawnFn: async () => {
			throw Error("No dispatch allowed");
		},
	});
	setTaskRegistry(server.taskRegistry);
	await initializeReviewPathRuntime();
	const { appRouter } = await import("../../../src/main/trpc/routers");
	setupTRPCIPC(appRouter);
	const handlers = new Map<
		string,
		Map<string, (input: Record<string, unknown>) => Promise<unknown>>
	>();
	ipcMain.handle("fixture:command", async (_event, action: string, input: any) => {
		if (action === "restart") {
			let revoked = false;
			try {
				getReviewPathStorage().authenticateCapability(oldCapability);
			} catch {
				revoked = true;
			}
			return {
				identity: restartIdentity,
				revoked,
				mapState: getReviewPathStorage().getRun(surviving.id)?.state,
				questionState: getReviewPathStorage().getRun(missing.run.id)?.state,
				surviving: manager.has(survivorId),
			};
		}
		if (action === "inspect")
			return {
				writes,
				inventoryEntered,
				providerEntered,
				createEntered,
				readySessions: manager
					.list()
					.filter((s) => manager.getBuffer(s.id).includes("DISPOSABLE_CLI_READY"))
					.map((s) => s.id),
				runs: getReviewPathStorage().getActiveRuns(),
				drafts: db.select().from(schema.reviewDrafts).all(),
				comments: db.select().from(schema.draftComments).all(),
				sessionRows: db.select().from(schema.terminalSessions).all(),
				sessions: await originalInventory(),
			};
		if (action === "hold-provider") {
			providerEntered = false;
			providerReadsRemaining = input ?? 2;
			providerGate = new Promise((resolve) => {
				releaseProvider = resolve;
			});
			return;
		}
		if (action === "release-provider") {
			const release = releaseProvider;
			releaseProvider = undefined;
			release?.();
			return;
		}
		if (action === "hold-create") {
			createEntered = false;
			createGate = new Promise((resolve) => {
				releaseCreate = resolve;
			});
			return;
		}
		if (action === "release-create") {
			const release = releaseCreate;
			releaseCreate = undefined;
			release?.();
			return;
		}
		if (action === "revisions")
			return {
				second: process.env["SS_LIFECYCLE_SECOND"],
				third: process.env["SS_LIFECYCLE_THIRD"],
			};
		if (action === "hold-inventory") {
			inventoryEntered = false;
			inventoryGate = new Promise((resolve) => {
				releaseInventory = resolve;
			});
			return;
		}
		if (action === "release-inventory") {
			const release = releaseInventory;
			releaseInventory = undefined;
			release?.();
			return;
		}
		if (action === "head") {
			head = input;
			return;
		}
		if (action === "provider-failure") {
			providerFailure = input;
			return;
		}
		if (action === "disconnect") {
			client.disconnect();
			return;
		}
		if (action === "reconnect") {
			await client.connect();
			return;
		}
		if (action === "exit") {
			client.write(input, "exit\r");
			return;
		}
		if (action === "tool") {
			const { launch, name, args } = input;
			let registered = handlers.get(launch.terminalId);
			if (!registered) {
				const script = readFileSync(launch.launchScript, "utf8");
				const token = /SUPER[I]ORSWARM_TASK_TOKEN='([^']+)'/.exec(script)?.[1];
				if (!token) throw Error("No task token");
				const response = await fetch(
					`http://127.0.0.1:${server.port}/context.resolve?taskToken=${token}`,
					{ headers: { Authorization: `Bearer ${server.token}` } }
				);
				if (!response.ok) throw Error(`Bootstrap ${response.status}`);
				const context = await response.json();
				registered = new Map();
				registerReviewPathTools(
					{
						tool: (name: string, _description: unknown, _schema: unknown, handler: any) =>
							registered!.set(name, handler),
					} as any,
					{ context, discovery: { port: server.port, token: server.token } }
				);
				handlers.set(launch.terminalId, registered);
			}
			const handler = registered.get(name);
			if (!handler) throw Error("Unregistered MCP tool");
			return handler(args);
		}
		throw Error(`Unknown fixture command ${action}`);
	});
	ipcMain.handle("fixture:complete", async (_event, result) => {
		writeFileSync(join(root!, "result.json"), JSON.stringify(result, null, 2));
		manager.disposeAll();
		client.disconnect();
		socket.close();
		await server.stop();
		await new Promise((resolve) => setTimeout(resolve, 300));
		app.exit(0);
	});
	const window = new BrowserWindow({
		show: false,
		webPreferences: {
			contextIsolation: true,
			sandbox: true,
			preload: join(root!, "preload.cjs"),
			backgroundThrottling: false,
		},
	});
	window.webContents.session.webRequest.onBeforeRequest((details, done) =>
		done({ cancel: !details.url.startsWith("file:") })
	);
	rendererTrust.register(
		window.webContents.id,
		`${pathToFileURL(join(root!, "index.html")).href}?head=${head}`
	);
	await window.loadFile(join(root!, "index.html"), { query: { head } });
}
void run().catch((error) => {
	console.error(error);
	manager.disposeAll();
	app.exit(1);
});
