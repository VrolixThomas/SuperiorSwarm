import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app, ipcMain, session } from "electron";
import { PtyManager } from "../../../src/daemon/pty-manager";
import type { ScrollbackStore } from "../../../src/daemon/scrollback-store";
import { SocketServer } from "../../../src/daemon/socket-server";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { listWorkspaceQueue } from "../../../src/main/activity-queue/workspace-queue";
import { getDb } from "../../../src/main/db";
import { agentMessages, projects, terminalSessions, workspaces } from "../../../src/main/db/schema";
import { AgentSessionManager } from "../../../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../../../src/main/services/agent-session-manager-handle";
import { setStatus } from "../../../src/main/services/workspace-service";
import { DaemonClient } from "../../../src/main/terminal/daemon-client";
import { setDaemonClient } from "../../../src/main/terminal/daemon-instance";
import { setupTerminalIPC } from "../../../src/main/terminal/ipc";
import { rendererTrust } from "../../../src/main/terminal/renderer-trust";
import { publicProcedure, router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
import { agentSessionsRouter } from "../../../src/main/trpc/routers/agent-sessions";
import { workspacesRouter } from "../../../src/main/trpc/routers/workspaces";
import { checkSidebarInteractions } from "./sidebar-interactions";
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
let step = "start";
const until = async (fn: () => boolean | Promise<boolean>) => {
	for (let i = 0; i < 200; i++) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	if (win) {
		console.error(
			"FIXTURE_DOM",
			await win.webContents.executeJavaScript("document.body.innerText")
		);
		await win.webContents
			.capturePage()
			.then((c) => writeFileSync(join(root, "queue-failure.png"), c.toPNG()));
	}
	throw new Error(`Timed out: ${step}`);
};
async function run() {
	await app.whenReady();
	server.listen();
	await daemon.connect();
	setDaemonClient(daemon);
	migrate(getDb(), { migrationsFolder: migrations });
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
	getDb()
		.insert(agentMessages)
		.values({
			id: "q1",
			projectId: "p1",
			fromWorkspaceId: "w1",
			kind: "question",
			content:
				"Should a reopened workspace restore the last active chat? The previous chat may still be waiting for your answer while another terminal is running. We can restore the last selected chat, or open the chat that currently needs input. This should also work when you return from a different project, close and reopen the application, or switch between an orchestrator and its workspaces. Which behavior should we use?",
			createdAt: now,
		})
		.run();
	await setStatus(
		{ kind: "workspace", projectId: "p1", workspaceId: "w2" },
		{ phase: "done", statusText: "Queue changes are ready for your review." }
	);
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
	const appRouter = router({
		projects: router({ list: publicProcedure.query(() => getDb().select().from(projects).all()) }),
		crossRepoOrchestrators: router({
			list: publicProcedure.query(() => []),
			memberCounts: publicProcedure.query(() => ({})),
		}),
		activityQueue: activityQueueRouter,
		agentSessions: agentSessionsRouter,
		workspaces: workspacesRouter,
		aiReview: router({ getReviewDrafts: publicProcedure.query(() => []) }),
		prPoller: router({ getCachedPRs: publicProcedure.query(() => []) }),
	});
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
	const js = <T = unknown>(code: string): Promise<T> => contents.executeJavaScript(code);
	const count = (n: number) =>
		js<boolean>(`!!document.querySelector('button[data-queue-trigger][aria-label="Queue ${n}"]')`);
	const click = (label: string) =>
		js(
			`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b)throw new Error('Missing '+${JSON.stringify(label)});b.click();})()`
		);
	const key = (name: string) => {
		const keyCode =
			(
				{ ArrowDown: "Down", ArrowUp: "Up", ArrowLeft: "Left", ArrowRight: "Right" } as Record<
					string,
					string
				>
			)[name] ?? name;
		contents.sendInputEvent({ type: "keyDown", keyCode });
		contents.sendInputEvent({ type: "keyUp", keyCode });
	};
	step = "loading state";
	await until(() => js<boolean>("document.body.textContent.includes('Loading workspaces')"));
	await contents
		.capturePage()
		.then((c) => writeFileSync(join(root, "queue-loading.png"), c.toPNG()));
	releaseInventory();
	daemon.listSessionsStrict = readInventory;
	step = "workspace-only list";
	await until(() => count(3));
	await until(() => js<boolean>("document.querySelectorAll('[data-queue-row]').length===3"));
	if (await js<boolean>("document.body.textContent.includes('EXTERNAL PR')"))
		throw new Error("External queue source leaked");
	const nav = await js<string[]>(
		"[...document.querySelectorAll('nav button')].map(b=>b.textContent.trim().replace(/\\s+/g,' '))"
	);
	if (!nav[0]?.startsWith("Queue") || nav.at(-1) !== "Settings")
		throw new Error("Wrong rail order");
	await js("document.querySelector('main').focus()");
	key("ArrowDown");
	await until(() => js<boolean>("document.activeElement?.hasAttribute('data-queue-row') ?? false"));
	if (!(await js<boolean>("parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=2")))
		throw new Error("Queue keyboard focus invisible");
	key("Home");
	for (const [width, height] of [
		[800, 600],
		[1440, 900],
		[2304, 1296],
		[1200, 500],
	] as const) {
		win.setContentSize(width, height);
		await new Promise((r) => setTimeout(r, 100));
		const fit = await js<{
			overflow: boolean;
			panel: boolean;
			rowHeight: number;
			fillsWindow: boolean;
			railAligned: boolean;
			workspacePanels: boolean;
			panelFits: boolean;
		}>(
			"({overflow:document.documentElement.scrollWidth>innerWidth,panel:getComputedStyle(document.querySelector('[aria-label=\"Queue item details\"]')).display!=='none',rowHeight:document.querySelector('[data-queue-row]').getBoundingClientRect().height, fillsWindow: (()=>{const r=document.querySelector('main').getBoundingClientRect();return r.left===72&&r.right===innerWidth&&r.bottom===innerHeight})(), railAligned:[...document.querySelectorAll('nav button')].every(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('svg').getBoundingClientRect();return r.width>=48&&r.width===document.querySelector('nav button').getBoundingClientRect().width&&Math.abs(r.x+r.width/2-36)<1&&Math.abs(i.x+i.width/2-36)<1}),workspacePanels:!!document.querySelector('[data-workspace-diff], [data-workspace-sidebar]'),panelFits:(()=>{const p=document.querySelector('[aria-label=\"Queue item details\"]');return getComputedStyle(p).display==='none'||(p.getBoundingClientRect().bottom===innerHeight&&getComputedStyle(p).overflowY==='auto')})()})"
		);
		if (
			fit.overflow ||
			fit.panel !== width >= 1100 ||
			fit.rowHeight !== 42 ||
			!fit.fillsWindow ||
			!fit.railAligned ||
			fit.workspacePanels ||
			!fit.panelFits
		)
			throw new Error(`Layout mismatch ${width}: ${JSON.stringify(fit)}`);
		for (const label of ["Queue 3", "Projects", "Tickets", "PRs", "Agents", "Settings"]) {
			const point = await js<{ x: number; y: number }>(`(() => {
				const r = document.querySelector('nav button[aria-label="${label}"]').getBoundingClientRect();
				return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)};
			})()`);
			contents.sendInputEvent({ type: "mouseMove", ...point });
			await until(() =>
				js<boolean>(
					`document.querySelector('[role="tooltip"]')?.textContent.startsWith(${JSON.stringify(label.split(" ")[0])}) ?? false`
				)
			);
			const tooltipFits = await js<boolean>(`(() => {
				const r = document.querySelector('[role="tooltip"]').getBoundingClientRect();
				return r.left >= 72 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
			})()`);
			if (!tooltipFits) throw new Error(`Clipped rail tooltip: ${label} at ${width}x${height}`);
			if (label === "Tickets" && width === 800)
				await contents
					.capturePage()
					.then((c) => writeFileSync(join(root, "rail-hover.png"), c.toPNG()));
		}
		contents.sendInputEvent({ type: "mouseMove", x: width - 20, y: height - 20 });
		await until(() => js<boolean>("!document.querySelector('[role=tooltip]')"));
		await contents
			.capturePage()
			.then((c) => writeFileSync(join(root, `queue-${width}x${height}.png`), c.toPNG()));
		if (height === 500) {
			const actionsReachable = await js<boolean>(`(() => {
				const panel = document.querySelector('[aria-label="Queue item details"]');
				panel.scrollTop = panel.scrollHeight;
				const buttons = [...panel.querySelectorAll('button')];
				return panel.scrollTop > 0 && buttons.every(button => {
					button.scrollIntoView({block: "nearest"});
					const rect = button.getBoundingClientRect();
					return rect.top >= panel.getBoundingClientRect().top && rect.bottom <= innerHeight;
				});
			})()`);
			if (!actionsReachable) throw new Error("Queue detail actions unreachable in short window");
			await contents
				.capturePage()
				.then((c) => writeFileSync(join(root, "queue-short-scrolled.png"), c.toPNG()));
			await js("document.querySelector('[aria-label=\"Queue item details\"]').scrollTop=0");
		}
	}
	win.setContentSize(1440, 900);
	for (const [index, name] of [
		[1, "permission"],
		[2, "report"],
	] as const) {
		await js(`document.querySelectorAll('[data-queue-row]')[${index}].click()`);
		await new Promise((r) => setTimeout(r, 30));
		await contents
			.capturePage()
			.then((c) => writeFileSync(join(root, `queue-${name}-context.png`), c.toPNG()));
	}
	await js("document.querySelectorAll('[data-queue-row]')[0].click()");
	await click("Projects");
	step = "workspace layout retained outside Queue";
	await until(() =>
		js<boolean>(
			"document.querySelector('[data-workspace-diff]')?.getBoundingClientRect().width > 0"
		)
	);
	step = "sidebar scroll bounds";
	await until(() =>
		js<boolean>(
			"document.querySelector('[data-sidebar-band-body=repositories]')?.textContent.includes('Workspace 30') ?? false"
		)
	);
	const sidebarBounds = await js(`(() => {
		const metrics = el => {const r=el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflowY};};
		return {height:innerHeight, sidebar:metrics(document.querySelector('[data-workspace-sidebar]')), bands:[...document.querySelectorAll('[data-sidebar-band]')].map(metrics), bodies:[...document.querySelectorAll('[data-sidebar-band-body]')].map(metrics)};
	})()`);
	writeFileSync(join(root, "sidebar-bounds.json"), JSON.stringify(sidebarBounds, null, 2));
	if (
		!(await js<boolean>(
			"[...document.querySelectorAll('[data-sidebar-band]')].every(el=>el.getBoundingClientRect().bottom<=innerHeight)"
		))
	)
		throw new Error("Sidebar bands extend below window");
	contents.debugger.attach("1.3");
	for (const height of [900, 600]) {
		win.setContentSize(1440, height);
		await until(() =>
			js<boolean>(
				"document.querySelector('[data-workspace-sidebar]').getBoundingClientRect().bottom===innerHeight"
			)
		);
		for (const band of ["folders", "repositories"]) {
			step = `${band} native wheel at ${height}`;
			const point = await js<{ x: number; y: number; top: number }>(`(() => {
				const el = document.querySelector('[data-sidebar-band-body="${band}"]');
				const r=el.getBoundingClientRect();
				return {x:r.x+r.width/2,y:r.y+r.height/2,top:el.parentElement.getBoundingClientRect().top};
			})()`);
			await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: point.x,
				y: point.y,
				deltaX: 0,
				deltaY: 10000,
			});
			await until(() =>
				js<boolean>(
					`(() => {const el=document.querySelector('[data-sidebar-band-body="${band}"]'); return el.scrollTop>0 && el.scrollTop+el.clientHeight>=el.scrollHeight-1;})()`
				)
			);
			if (
				!(await js<boolean>(`(() => {
				const el=document.querySelector('[data-sidebar-band-body="${band}"]');
				const last=el.firstElementChild.lastElementChild.getBoundingClientRect();
				return last.bottom<=el.getBoundingClientRect().bottom+1 && Math.abs(el.parentElement.getBoundingClientRect().top-${point.top})<1 && document.querySelector('[data-workspace-sidebar]').scrollTop===0;
			})()`))
			)
				throw new Error("Sidebar header moved or last item unreachable");
			if (band === "repositories")
				await contents
					.capturePage({ x: 72, y: 0, width: 360, height })
					.then((c) => writeFileSync(join(root, `sidebar-scrolled-${height}.png`), c.toPNG()));
			await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: point.x,
				y: point.y,
				deltaX: 0,
				deltaY: -10000,
			});
			await until(() =>
				js<boolean>(`document.querySelector('[data-sidebar-band-body="${band}"]').scrollTop===0`)
			);
		}
	}
	contents.debugger.detach();
	await js("document.querySelector('[data-sidebar-band=folders] button[aria-expanded]').click()");
	await until(() => js<boolean>("!document.querySelector('[data-sidebar-band-body=folders]')"));
	if (
		!(await js<boolean>(
			"document.querySelector('[data-sidebar-band=orchestrators]').getBoundingClientRect().bottom<=innerHeight"
		))
	)
		throw new Error("Collapsed sections overflow");
	await js("document.querySelector('[data-sidebar-band=folders] button[aria-expanded]').click()");
	win.setContentSize(1440, 900);
	step = "section dragging";
	await checkSidebarInteractions(contents, root);
	const ticketsPoint = await js<{ x: number; y: number }>(`(() => {
		const r = document.querySelector('nav button[aria-label="Tickets"]').getBoundingClientRect();
		return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
	})()`);
	contents.sendInputEvent({ type: "mouseMove", ...ticketsPoint });
	await until(() =>
		js<boolean>(
			"document.querySelector('[role=tooltip]')?.textContent.startsWith('Tickets') ?? false"
		)
	);
	await new Promise((resolve) => setTimeout(resolve, 200));
	if (
		!(await js<boolean>(
			`getComputedStyle(document.querySelector('nav button[aria-label="Tickets"]')).backgroundColor !== getComputedStyle(document.querySelector('nav button[aria-current="page"]')).backgroundColor`
		))
	)
		throw new Error("Hover looks identical to selected navigation");
	await contents
		.capturePage({ x: 0, y: 0, width: 280, height: 500 })
		.then((c) => writeFileSync(join(root, "rail-hover-projects.png"), c.toPNG()));
	contents.sendInputEvent({ type: "mouseMove", x: 700, y: 600 });
	await until(() => js<boolean>("!document.querySelector('[role=tooltip]')"));
	const workspaceLayout = await js<string>(
		"localStorage.getItem('react-resizable-panels:app-layout')"
	);
	await click("Queue 3");
	await until(() =>
		js<boolean>(
			"!!document.querySelector('[data-queue-row]') && !document.querySelector('[data-workspace-diff]')"
		)
	);
	if (
		(await js<string>("localStorage.getItem('react-resizable-panels:app-layout')")) !==
		workspaceLayout
	)
		throw new Error("Queue overwrote saved workspace layout");
	await js("document.querySelector('main').focus()");
	key("Enter");
	step = "Open navigates without handling";
	await until(() => js<boolean>("!!document.querySelector('textarea')"));
	await until(() =>
		js<boolean>(
			"document.querySelector('[data-workspace-diff]')?.getBoundingClientRect().width > 0"
		)
	);
	if ((await listWorkspaceQueue()).totalPending !== 3) throw new Error("Open handled an item");
	await click("Queue 3");
	await until(() => js<boolean>("!!document.querySelector('[data-queue-row]')"));
	await js("document.querySelector('main').focus()");
	key("e");
	step = "Done";
	await until(() => count(2));
	await until(() =>
		js<boolean>("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Undo'))")
	);
	key("z");
	step = "Undo";
	await until(() => count(3));
	await until(() =>
		js<boolean>(
			"document.body.textContent.includes('Restored to the queue') && document.querySelector('[aria-label=\"Queue item details\"] button')?.disabled===false"
		)
	);
	key("h");
	await until(() => js<boolean>("!!document.querySelector('dialog')"));
	key("1");
	step = "Later";
	await until(() => count(2));
	await click("Later 1");
	await until(() => js<boolean>("document.querySelectorAll('[data-queue-row]').length===1"));
	await js("document.querySelector('main').focus()");
	key("b");
	step = "Bring back";
	await until(() => count(3));
	await click("All3");
	await until(() => js<boolean>("document.querySelectorAll('[data-queue-row]').length===3"));
	// Change the selected question between display and action. Mutation must refuse the old revision.
	const selected = await js<string>(
		"document.querySelector('[data-queue-row][aria-current=true]').getAttribute('data-queue-row')"
	);
	if (selected !== "agent-question:q1")
		throw new Error(`Unexpected selected question: ${selected}`);
	getDb()
		.update(agentMessages)
		.set({ content: "The question has changed. Review the latest options." })
		.where(eq(agentMessages.id, "q1"))
		.run();
	await js("document.querySelector('main').focus()");
	key("e");
	step = "Conflict keeps selection";
	await until(() => js<boolean>("document.body.textContent.includes('This item changed')"));
	if (
		(await js<string>(
			"document.querySelector('[data-queue-row][aria-current=true]').getAttribute('data-queue-row')"
		)) !== selected
	)
		throw new Error("Conflict advanced selection");
	if ((await listWorkspaceQueue()).totalPending !== 3)
		throw new Error("Conflict handled newer activity");
	await contents
		.capturePage()
		.then((c) => writeFileSync(join(root, "queue-conflict.png"), c.toPNG()));
	step = "partial unavailable inventory";
	daemon.disconnect();
	await click("Refresh queue");
	await until(() =>
		js<boolean>("document.body.textContent.includes('Current agent status is unavailable')")
	);
	await contents
		.capturePage()
		.then((c) => writeFileSync(join(root, "queue-partial.png"), c.toPNG()));
	await daemon.connect();
	await click("Refresh queue");
	await until(() =>
		js<boolean>("!document.body.textContent.includes('Current agent status is unavailable')")
	);
	step = "query error recovery";
	ipcMain.removeHandler("trpc:request");
	ipcMain.handle("trpc:request", () => ({
		error: {
			message: "Workspace refresh failed. Try again.",
			code: "INTERNAL_SERVER_ERROR",
			data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
		},
	}));
	await click("Refresh queue");
	await until(() => js<boolean>("document.body.textContent.includes('Workspace refresh failed')"));
	await contents.capturePage().then((c) => writeFileSync(join(root, "queue-error.png"), c.toPNG()));
	ipcMain.removeHandler("trpc:request");
	setupTRPCIPC(appRouter);
	await click("Refresh queue");
	await until(() => js<boolean>("!document.body.textContent.includes('Workspace refresh failed')"));
	step = "keyboard clears queue to honest empty state";
	await js("document.querySelector('main').focus()");
	for (const n of [2, 1, 0]) {
		await until(() =>
			js<boolean>(
				"document.querySelector('[aria-label=\"Queue item details\"] button')?.disabled===false"
			)
		);
		key("e");
		await until(() => count(n));
	}
	await until(() => js<boolean>("document.body.textContent.includes('Nothing needs you.')"));
	await contents.capturePage().then((c) => writeFileSync(join(root, "queue-empty.png"), c.toPNG()));
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify({
			workspaceOnly: true,
			openOnly: true,
			doneUndo: true,
			laterBringBack: true,
			conflictPreserves: true,
			layout: true,
			keyboard: true,
			contentStates: true,
		})
	);
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
		console.error("WORKSPACE_QUEUE_FAILURE", step, error);
		finish(1);
	});
