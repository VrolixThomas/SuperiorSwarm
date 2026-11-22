import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app, session } from "electron";
import { z } from "zod";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import {
	describeProjectHookQueueItem,
	isProjectHookQueueItemCurrent,
	listProjectHookStatus,
	reconcileProjectHookOutput,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../../../src/main/activity-queue/hook-source";
import { isPRQueueItemCurrent } from "../../../src/main/activity-queue/pr-scope";
import { describePRQueueItem } from "../../../src/main/activity-queue/pr-source";
import {
	listQueueView,
	registerExternalQueueAdapter,
} from "../../../src/main/activity-queue/queue-view";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { isTicketQueueItemCurrent } from "../../../src/main/activity-queue/ticket-runtime";
import {
	describeTicketQueueItem,
	observeTicketPoll,
} from "../../../src/main/activity-queue/ticket-source";
import { closeDb, getDb } from "../../../src/main/db";
import {
	githubAuth,
	linearAuth,
	projects,
	terminalSessions,
	workspaces,
} from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { publicProcedure, router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
import { agentSessionsRouter } from "../../../src/main/trpc/routers/agent-sessions";
import { queueHooksRouter } from "../../../src/main/trpc/routers/queue-hooks";
import type { TicketQueueFact, TicketQueueLink } from "../../../src/shared/ticket-queue";
const root = process.env["SS_QUEUE_FIXTURE_ROOT"]!;
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "logs"));
app.disableHardwareAcceleration();
const ptys = new PtyManager();
const server = new SocketServer(
	ptys,
	{ flush: () => [] } as unknown as ScrollbackStore,
	join(root, "d.sock")
);
const daemon = new DaemonClient(join(root, "d.sock"), join(root, "pid"), join(root, "daemon.log"));
let manager: AgentSessionManager;
let win: BrowserWindow;
let step = "setup";
let networkCalls = 0;
Object.defineProperty(globalThis, "fetch", {
	value: async () => {
		networkCalls++;
		throw Error("No network in mixed fixture");
	},
});
async function run() {
	await app.whenReady();
	migrate(getDb(), { migrationsFolder: process.env["SS_QUEUE_MIGRATIONS"]! });
	server.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	const now = new Date();
	for (const [id, kind] of [
		["repo", "repo"],
		["folder", "folder"],
	] as const) {
		mkdirSync(join(root, id));
		getDb()
			.insert(projects)
			.values({
				id,
				name: id === "repo" ? "Mixed repository" : "Mixed folder",
				kind,
				repoPath: join(root, id),
				remoteHost: "github.com",
				remoteOwner: "fixture",
				remoteRepo: "repo",
				createdAt: now,
				updatedAt: now,
			})
			.run();
	}
	const cases = [
		{ id: "w-repo", project: "repo", type: "branch", provider: "claude" },
		{ id: "w-folder", project: "folder", type: "folder", provider: "codex" },
		{ id: "w-orchestrator", project: "repo", type: "branch", provider: "codex" },
	] as const;
	manager = new AgentSessionManager({
		daemonClient: daemon,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	setAgentSessionManager(manager);
	for (const c of cases) {
		getDb()
			.insert(workspaces)
			.values({
				id: c.id,
				projectId: c.project,
				type: c.type,
				isOrchestrator: c.id === "w-orchestrator",
				name: c.id,
				prProvider: c.id === "w-repo" ? "github" : null,
				prIdentifier: c.id === "w-repo" ? "fixture/repo#8" : null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		const terminalId = `terminal-${c.id}`;
		const cwd = join(root, c.project);
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId: c.id,
				cwd,
				title: `${c.provider} ${c.id} result`,
				sortOrder: 0,
				updatedAt: now,
			})
			.run();
		await daemon.create(
			terminalId,
			cwd,
			() => {},
			() => {},
			{ HOME: root, SHELL: "/bin/sh" }
		);
		manager.registerManagedSession({
			terminalId,
			workspaceId: c.id,
			provider: c.provider,
			providerSessionId: `conversation-${c.id}`,
			skipPermissions: false,
		});
		manager.handleAgentEvent({
			agent: c.provider,
			sessionId: terminalId,
			terminalId,
			workspaceId: c.id,
			providerSessionId: `conversation-${c.id}`,
			timestamp: Date.now(),
			producerTimestamp: Date.now(),
			cwd,
			rawEvent: "Stop",
			turnId: `turn-${c.id}`,
			alert: "task-complete",
			evidence: [
				{
					kind: "reply",
					text: `Review ${c.id} changes; this is a controlled provider event.`,
					provider: c.provider,
					rawEvent: "Stop",
					sourceField: "last_assistant_message",
					truncated: false,
					redacted: false,
				},
			],
		});
	}
	getDb()
		.insert(githubAuth)
		.values({ id: "github", accountId: "fixture", accessToken: "synthetic" })
		.run();
	getDb()
		.insert(linearAuth)
		.values({
			id: "linear",
			accountId: "fixture",
			accessToken: "synthetic",
			refreshToken: "synthetic",
			expiresAt: new Date(Date.now() + 3600000),
		})
		.run();
	registerExternalQueueAdapter(["pr-review", "pr-feedback"], {
		describe: describePRQueueItem,
		current: isPRQueueItemCurrent,
	});
	registerExternalQueueAdapter(["ticket-start", "ticket-feedback"], {
		describe: describeTicketQueueItem,
		current: isTicketQueueItemCurrent,
	});
	registerExternalQueueAdapter(["project-hook"], {
		describe: describeProjectHookQueueItem,
		current: isProjectHookQueueItemCurrent,
	});
	const queue = new ActivityQueueService();
	for (const [number, kind] of [
		[7, "pr-review"],
		[8, "pr-feedback"],
	] as const)
		queue.observe({
			sourceId: `fixture-pr-${number}`,
			sourceType: "pr",
			fingerprint: "first",
			snapshot: {},
			observedAt: Date.now(),
			candidate: {
				kind,
				title:
					kind === "pr-review"
						? "Review another person's change"
						: "Respond to feedback on my change",
				summary:
					kind === "pr-review" ? "Your review was requested" : "Riley asks for a regression test",
				occurredAt: Date.now(),
				projectId: "repo",
				projectName: "Mixed repository",
				reasons: [
					{
						code: kind,
						label:
							kind === "pr-review"
								? "Inspect the current diff"
								: "Riley: please add the missing regression case",
					},
				],
				target: {
					type: "pr",
					provider: "github",
					accountId: "fixture",
					host: "github.com",
					owner: "fixture",
					repo: "repo",
					number,
					title: `PR ${number}`,
					sourceBranch: `feature-${number}`,
					targetBranch: "main",
					projectId: "repo",
				},
			},
		});
	queue.markUnavailable("fixture-pr-7", "Provider evidence reads disabled in isolated native UI");
	const account = { provider: "linear", accountId: "fixture", siteId: "linear.app" } as const;
	const facts: TicketQueueFact[] = [
		{
			provider: "linear",
			id: "intake",
			identifier: "SUP-INTAKE",
			title: "Start the assigned ticket",
			url: "https://linear.app/fixture/issue/SUP-INTAKE",
			groupId: "fixture",
			groupName: "Fixture team",
			status: { id: "todo", name: "Todo", color: "gray" },
			assigneeId: "fixture",
			state: "unstarted",
		},
		{
			provider: "linear",
			id: "feedback",
			identifier: "SUP-FEEDBACK",
			title: "Respond on the active ticket",
			url: "https://linear.app/fixture/issue/SUP-FEEDBACK",
			groupId: "fixture",
			groupName: "Fixture team",
			status: { id: "started", name: "Started", color: "gray" },
			assigneeId: "fixture",
			state: "started",
			comments: [],
		},
	];
	const links = new Map<string, TicketQueueLink>([
		[
			"feedback",
			{
				workspaceId: "w-folder",
				workspaceName: "w-folder",
				projectId: "folder",
				projectName: "Mixed folder",
			},
		],
	]);
	observeTicketPoll({ account, facts, links, showAll: true, observedAt: Date.now() }, queue);
	facts[1]!.comments = [
		{
			id: "comment-1",
			authorId: "reviewer",
			author: "Sam",
			body: "Please clarify the test expectation",
			createdAt: Date.now(),
		},
	];
	observeTicketPoll({ account, facts, links, showAll: true, observedAt: Date.now() }, queue);
	mkdirSync(join(root, "repo/.superiorswarm"));
	writeFileSync(
		join(root, "repo/.superiorswarm/queue.yml"),
		"hooks:\n  - id: check\n    title: Synthetic check\n    run: never-executed-fixture-command\n    every: 5m\n"
	);
	setProjectHooksEnabled(true);
	const status = listProjectHookStatus().find((s) => s.projectId === "repo")!;
	assert(status.hash);
	trustProjectHooks("repo", status.hash);
	reconcileProjectHookOutput(
		{ id: "repo", name: "Mixed repository" },
		{ root: status.root, hash: status.hash },
		{ id: "check", title: "Synthetic check" },
		[{ key: "pending", title: "Inspect synthetic check", why: "The hook check needs inspection" }]
	);
	const initial = await listQueueView();
	assert.equal(initial.items.length, 8);
	assert.equal(initial.totalPending, 8);
	const items = Object.fromEntries(
		initial.items.map((i) => [i.target.type === "terminal" ? i.target.workspaceId : i.kind, i])
	);
	const receipts = () =>
		Object.fromEntries(
			queue
				.list({ includeAcknowledged: true })
				.items.map((i) => [i.id, [i.revision, i.acknowledged]])
		);
	const originalReceipts = receipts();
	const beforePids = (await daemon.listSessionsStrict()).map((s) => [s.id, s.pid]);
	const readWorkspace = (id: string) => {
		const w = getDb().select().from(workspaces).where(eq(workspaces.id, id)).get();
		return w ? { ...w, path: join(root, w.projectId === "folder" ? "folder" : "repo") } : null;
	};
	setupTRPCIPC(
		router({
			activityQueue: activityQueueRouter,
			queueHooks: queueHooksRouter,
			agentSessions: agentSessionsRouter,
			projects: router({
				getByRepo: publicProcedure
					.input(z.object({ owner: z.string(), repo: z.string() }))
					.query(({ input }) =>
						input.owner === "fixture" && input.repo === "repo"
							? getDb().select().from(projects).where(eq(projects.id, "repo")).all()
							: []
					),
			}),
			workspaces: router({
				getById: publicProcedure
					.input(z.object({ id: z.string() }))
					.query(({ input }) => readWorkspace(input.id)),
				getOrCreateReview: publicProcedure
					.input(
						z.object({
							projectId: z.string(),
							prProvider: z.string(),
							prIdentifier: z.string(),
							prTitle: z.string(),
							sourceBranch: z.string(),
							targetBranch: z.string(),
						})
					)
					.mutation(({ input }) => {
						assert.equal(input.projectId, "repo");
						assert.equal(input.prProvider, "github");
						assert(["fixture/repo#7", "fixture/repo#8"].includes(input.prIdentifier));
						return {
							id: `review-${input.prIdentifier.endsWith("#7") ? 7 : 8}`,
							worktreePath: join(root, "repo"),
						};
					}),
			}),
			aiReview: router({ getReviewDrafts: publicProcedure.query(() => []) }),
			prPoller: router({ getCachedPRs: publicProcedure.query(() => []) }),
		})
	);
	session.defaultSession.webRequest.onBeforeRequest((details, done) =>
		done({ cancel: !details.url.startsWith("file://") })
	);
	win = new BrowserWindow({
		show: false,
		width: 1450,
		height: 900,
		webPreferences: {
			preload: join(root, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	const wc = win.webContents;
	wc.on("console-message", (_event, ...values) => console.log("renderer", ...values));
	rendererTrust.register(wc.id, pathToFileURL(join(root, "index.html")).href);
	setupTerminalIPC(daemon, manager);
	await win.loadFile(join(root, "index.html"));
	win.show();
	app.focus({ steal: true });
	win.focus();
	wc.focus();
	const js = async <T = unknown>(code: string): Promise<T> => {
		writeFileSync(join(root, "operation.json"), JSON.stringify({ step, code }));
		return wc.executeJavaScript(code);
	};
	const until = async (fn: () => Promise<boolean>) => {
		for (let i = 0; i < 250; i++) {
			if (await fn()) return;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw Error(`${step}: ${await js("document.body.innerText")}`);
	};
	const refresh = () => js("window.mixedQueue.refresh()");
	const rows = (n: number) =>
		js<boolean>(
			`document.querySelectorAll('main[data-mixed-queue] [data-queue-row]').length===${n}`
		);
	const click = (text: string, scope = "document") =>
		js(
			`(()=>{const b=[...${scope}.querySelectorAll('button')].find(b=>b.textContent.replace(/\\s/g,'').endsWith(${JSON.stringify(text.replace(/\s/g, ""))})||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!b)throw Error('Missing '+${JSON.stringify(text)});b.click();})()`
		);
	const select = async (id: string) => {
		await js(
			`[...document.querySelectorAll('[data-queue-row]')].find(e=>e.dataset.queueRow===${JSON.stringify(id)}).click()`
		);
		await until(() =>
			js<boolean>(
				`[...document.querySelectorAll('[data-queue-row]')].find(e=>e.dataset.queueRow===${JSON.stringify(id)}).getAttribute('aria-current')==='true'`
			)
		);
	};
	const home = async () => {
		await click(`Queue ${(await listQueueView()).totalPending}`);
		await refresh();
		await until(async () => rows((await listQueueView()).items.length));
	};
	step = "mixed rows and badge";
	await until(() => rows(8));
	await until(() => js<boolean>("document.querySelector('[aria-label=\"Queue 8\"]')!==null"));
	const tabs = await js<string[]>(
		"[...document.querySelectorAll('[role=tab]')].map(e=>e.textContent.trim())"
	);
	assert.deepEqual(tabs, ["All8", "To review3", "PRs2", "Tickets2", "Checks1"]);
	for (const [label, n] of [
		["PRs 2", 2],
		["Tickets 2", 2],
		["Checks 1", 1],
		["To review 3", 3],
		["All 8", 8],
	] as const) {
		await click(label);
		await until(() => rows(n));
	}
	await click("Group by project G");
	await until(() => rows(8));
	assert.deepEqual(receipts(), originalReceipts);
	step = "later isolation";
	await select(items["ticket-feedback"]!.id);
	await click("Later H", "document.querySelector('[aria-label=\"Queue item details\"]')");
	const popoverStyle = await js<{
		theme: string;
		foreground: string;
		background: string;
		expected: string;
	}>(
		`(()=>{const d=document.querySelector('[aria-label="Set aside until"]');return {theme:document.documentElement.dataset.theme,foreground:getComputedStyle(d.querySelector(':scope > button:last-of-type')).color,background:getComputedStyle(d).backgroundColor,expected:getComputedStyle(document.body).color};})()`
	);
	writeFileSync(join(root, "later-colors.json"), JSON.stringify(popoverStyle, null, 2));
	await new Promise((r) => setTimeout(r, 100));
	await wc.capturePage().then((i) => writeFileSync(join(root, "later-popover.png"), i.toPNG()));
	assert.equal(
		popoverStyle.foreground,
		popoverStyle.expected,
		"Later options must inherit the theme foreground"
	);
	await click("Until it changes");
	await until(() => rows(7));
	await until(() => js<boolean>("document.querySelector('[aria-label=\"Queue 7\"]')!==null"));
	assert.deepEqual(receipts(), originalReceipts);
	await click("Later 1");
	await until(() => rows(1));
	await click("Bring back B", "document.querySelector('[aria-label=\"Queue item details\"]')");
	await until(() => rows(0));
	await js(
		"[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.startsWith('All')).click()"
	);
	await until(() => rows(8));
	step = "Done and Undo across sources";
	for (const key of ["w-repo", "ticket-start", "pr-feedback", "project-hook"]) {
		const item = items[key]!;
		await select(item.id);
		await click("Done E", "document.querySelector('[aria-label=\"Queue item details\"]')");
		await until(() => rows(7));
		const changed = Object.entries(receipts()).filter(
			([id, v]) => JSON.stringify(v) !== JSON.stringify(originalReceipts[id])
		);
		assert(changed.length > 0);
		assert(changed.every(([id]) => id === item.id || item.members?.some((m) => m.id === id)));
		await click("Undo Z");
		await until(() => rows(8));
		assert.deepEqual(receipts(), originalReceipts);
	}
	step = "Open targets without acknowledgment";
	for (const key of [
		"w-repo",
		"w-folder",
		"w-orchestrator",
		"ticket-start",
		"ticket-feedback",
		"pr-review",
		"pr-feedback",
		"project-hook",
	]) {
		const item = items[key]!;
		await select(item.id);
		await js(
			`(()=>{const p=document.querySelector('[aria-label="Queue item details"]');const b=[...p.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(item.openLabel)}));if(!b)throw Error('Missing Open');b.click();})()`
		);
		await until(() => js<boolean>("window.mixedQueue.state().segment!=='queue'"));
		const state = await js<{
			workspace: string | null;
			terminal: string | null;
			segment: string;
			project: string | null;
			ticket: string | null;
			pr: number | null;
			intent: string | null;
		}>("window.mixedQueue.state()");
		if (item.target.type === "terminal") {
			assert.equal(state.workspace, item.target.workspaceId);
			assert.equal(state.terminal, item.target.terminalId);
			assert.equal(state.intent, "attach-existing-only");
		} else if (item.target.type === "ticket") {
			assert.equal(state.segment, "tickets");
			assert.equal(state.ticket, item.target.ticketId);
		} else if (item.target.type === "pr") {
			assert.equal(state.pr, item.target.number);
			assert.equal(state.workspace, `review-${item.target.number}`);
		} else {
			assert.equal(state.project, "repo");
			assert.equal(state.workspace, null);
		}
		assert.deepEqual(receipts(), originalReceipts);
		await home();
	}
	step = "native shortcut navigation";
	await js("window.mixedQueue.end()");
	for (const key of ["w-repo", "w-folder", "w-orchestrator"]) {
		wc.sendInputEvent({ type: "keyDown", keyCode: "j", modifiers: ["meta"] });
		wc.sendInputEvent({ type: "keyUp", keyCode: "j", modifiers: ["meta"] });
		await until(() =>
			js<boolean>(`window.mixedQueue.state().sessionId===${JSON.stringify(items[key]!.id)}`)
		);
		assert.deepEqual(receipts(), originalReceipts);
	}
	await home();
	step = "mixed peek and jump";
	await js("window.mixedQueue.peek()");
	await until(() => js<boolean>("!!document.querySelector('[aria-label=\"Queue peek\"]')"));
	const peekIds = await js<string[]>(
		"[...document.querySelectorAll('[aria-label=\"Queue peek\"] [data-queue-row]')].map(e=>e.getAttribute('data-queue-row'))"
	);
	assert.equal(peekIds.length, 7);
	assert(peekIds.some((id) => initial.items.find((i) => i.id === id)?.category === "agents"));
	assert(peekIds.some((id) => initial.items.find((i) => i.id === id)?.category !== "agents"));
	assert.deepEqual(receipts(), originalReceipts);
	await click("Close · Esc", "document.querySelector('[aria-label=\"Queue peek\"]')");
	for (const key of ["w-repo", "ticket-feedback", "pr-feedback", "project-hook"]) {
		await js(`window.mixedQueue.jump(${JSON.stringify(items[key]!.id)})`);
		await until(() =>
			js<boolean>(`window.mixedQueue.state().sessionId===${JSON.stringify(items[key]!.id)}`)
		);
		assert.deepEqual(receipts(), originalReceipts);
		await home();
	}
	await wc.capturePage().then((i) => writeFileSync(join(root, "combined-wide.png"), i.toPNG()));
	win.setContentSize(800, 700);
	await new Promise((r) => setTimeout(r, 150));
	await wc.capturePage().then((i) => writeFileSync(join(root, "combined-narrow.png"), i.toPNG()));
	assert.equal(await js<boolean>("document.documentElement.scrollWidth>innerWidth"), false);
	await click("Details / reply");
	await until(() =>
		js<boolean>(
			`(()=>{const p=document.querySelector('[aria-label="Queue item details"]');const r=p.getBoundingClientRect();return getComputedStyle(p).display!=="none"&&r.left>=72&&r.right<=innerWidth&&r.bottom<=innerHeight;})()`
		)
	);
	await wc
		.capturePage()
		.then((i) => writeFileSync(join(root, "combined-narrow-details.png"), i.toPNG()));
	await click("Back to queue items");
	assert.deepEqual(receipts(), originalReceipts);
	assert.deepEqual(
		(await daemon.listSessionsStrict()).map((s) => [s.id, s.pid]),
		beforePids
	);
	assert.equal(networkCalls, 0);
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify(
			{
				mixedSources: 8,
				counts: true,
				receipts: true,
				navigation: true,
				peek: true,
				noNetwork: true,
				noShellReplacement: true,
				popoverStyle,
				contexts: ["repository", "folder", "project orchestrator"],
				seams: [
					"controlled provider events over real shell PTYs",
					"synthetic external observations",
					"review workspace provisioning returns preselected fixture destination",
					"hook output reconciled without command execution",
				],
			},
			null,
			2
		)
	);
}
async function finish(code: number) {
	manager?.dispose();
	daemon.disconnect();
	server.close();
	ptys.disposeAll();
	closeDb();
	win?.destroy();
	app.exit(code);
}
run().then(
	() => finish(0),
	async (error) => {
		console.error(step, error);
		if (win)
			await win.webContents
				.capturePage()
				.then((i) => writeFileSync(join(root, "failure.png"), i.toPNG()));
		await finish(1);
	}
);
