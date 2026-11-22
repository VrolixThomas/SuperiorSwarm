import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { BrowserWindow, app, session } from "electron";
import {
	describeProjectHookQueueItem,
	isProjectHookQueueItemCurrent,
	listProjectHookStatus,
	refreshProjectHookQueue,
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
import { getDb } from "../../../src/main/db";
import { githubAuth, linearAuth, projects } from "../../../src/main/db/schema";
import { router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { activityQueueRouter } from "../../../src/main/trpc/routers/activity-queue";
import { queueHooksRouter } from "../../../src/main/trpc/routers/queue-hooks";
const root = process.env["SS_QUEUE_FIXTURE_ROOT"]!;
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setAppLogsPath(join(root, "logs"));
app.disableHardwareAcceleration();
let win: BrowserWindow | undefined;
let networkCalls = 0;
Object.defineProperty(globalThis, "fetch", {
	value: async () => {
		networkCalls++;
		throw new Error("Fixture blocks network.");
	},
});
function check(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}
async function run() {
	await app.whenReady();
	migrate(getDb(), { migrationsFolder: process.env["SS_QUEUE_MIGRATIONS"]! });
	const now = new Date();
	const projectRoot = join(root, "repo");
	mkdirSync(join(projectRoot, ".superiorswarm"), { recursive: true });
	getDb()
		.insert(projects)
		.values({
			id: "repo",
			name: "Fixture repository",
			repoPath: projectRoot,
			createdAt: now,
			updatedAt: now,
		})
		.run();
	getDb()
		.insert(githubAuth)
		.values({ id: "github", accountId: "fixture", accessToken: "synthetic-not-a-token" })
		.run();
	getDb()
		.insert(linearAuth)
		.values({
			id: "linear",
			accountId: "fixture",
			accessToken: "synthetic-not-a-token",
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
	queue.observe({
		sourceId: "fixture-pr",
		sourceType: "pr",
		fingerprint: "first",
		snapshot: {},
		observedAt: Date.now(),
		candidate: {
			kind: "pr-review",
			title: "Review queue cleanup",
			summary: "Your review was requested",
			occurredAt: Date.now() - 1000,
			projectId: "repo",
			projectName: "Fixture repository",
			reasons: [{ code: "review-request", label: "A reviewer requested your inspection." }],
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
	queue.markUnavailable(
		"fixture-pr",
		"Provider capability reads are disabled in this isolated UI fixture."
	);
	observeTicketPoll(
		{
			account: { provider: "linear", accountId: "fixture", siteId: "linear.app" },
			facts: [
				{
					provider: "linear",
					id: "ticket",
					identifier: "SUP-FIXTURE",
					title: "Start queue investigation",
					url: "https://linear.app/fixture/issue/SUP-FIXTURE",
					groupId: "fixture",
					groupName: "Fixture team",
					status: { id: "todo", name: "Todo", color: "gray" },
					assigneeId: "fixture",
					state: "unstarted",
				},
			],
			links: new Map(),
			showAll: true,
			observedAt: Date.now(),
		},
		queue
	);
	const config = join(projectRoot, ".superiorswarm/queue.yml");
	const output = join(projectRoot, "output.jsonl");
	writeFileSync(
		config,
		"hooks:\n  - id: local-check\n    title: Synthetic local check\n    run: cat output.jsonl\n    every: 5m\n"
	);
	writeFileSync(
		output,
		`${JSON.stringify({ key: "check", title: "Verify callback", why: "The callback needs inspection." })}\n`
	);
	setProjectHooksEnabled(true);
	const status = listProjectHookStatus()[0];
	check(status?.hash, "Missing config hash");
	trustProjectHooks("repo", status.hash);
	await refreshProjectHookQueue("repo", true);
	const initial = await listQueueView();
	check(initial.totalPending === 3, "Unified source count");
	const hook = initial.items.find((i) => i.category === "hooks")!;
	check(hook, "Hook row");
	setupTRPCIPC(router({ activityQueue: activityQueueRouter, queueHooks: queueHooksRouter }));
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
	win.webContents.on("console-message", (_event, ...values) => console.log("renderer", ...values));
	console.log("loading");
	await win.loadFile(join(root, "index.html"));
	console.log("loaded");
	win.show();
	app.focus({ steal: true });
	win.focus();
	win.webContents.focus();
	const contents = win.webContents;
	const js = <T = unknown>(code: string): Promise<T> => contents.executeJavaScript(code);
	const until = async (fn: () => Promise<boolean>) => {
		for (let i = 0; i < 250; i++) {
			if (await fn()) return;
			await new Promise((r) => setTimeout(r, 20));
		}
		throw new Error(`DOM timeout: ${await js("document.body.innerText")}`);
	};
	const rowCount = (count: number) =>
		js<boolean>(`document.querySelectorAll('[data-queue-row]').length===${count}`);
	const click = (text: string) =>
		js(
			`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith(${JSON.stringify(text)})||b.getAttribute('aria-label')===${JSON.stringify(text)});if(!b)throw new Error('Missing button '+${JSON.stringify(text)});b.click();})()`
		);
	console.log("waiting rows");
	await until(() => rowCount(3));
	console.log("rows ready");
	console.log("select hook");
	await js(`document.querySelector('[data-queue-row="${hook.id}"]').click()`);
	await until(() =>
		js<boolean>(
			"document.querySelector('[aria-label=\"Queue item details\"]')?.textContent.includes('Synthetic local check')"
		)
	);
	// Open only uses the production hook action. No external URL exists in this fixture.
	console.log("hook selected");
	await click("Open project ↵");
	console.log("opened");
	check(queue.read(hook.id)?.acknowledgedRevision === null, "Open must not acknowledge");
	await click("Done E");
	await until(() => rowCount(2));
	await click("Undo Z");
	await until(() => rowCount(3));
	await click("Later H");
	await click("Until it changes");
	await until(() => rowCount(2));
	await click("Later 1");
	await until(() => rowCount(1));
	await click("Bring back B");
	await until(() => rowCount(0));
	await js(
		`[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim().startsWith('All')).click()`
	);
	await until(() => rowCount(3));
	await win.webContents
		.capturePage()
		.then((image) => writeFileSync(join(root, "external-queue.png"), image.toPNG()));
	// Native renderer mutations above exercise real IPC/SQLite. Source cleanup is the real runner.
	writeFileSync(output, "");
	await refreshProjectHookQueue("repo", true);
	check(
		!(await listQueueView()).items.some((i) => i.id === hook.id),
		"Complete empty hook output must resolve"
	);
	writeFileSync(
		output,
		`${JSON.stringify({ key: "check", title: "Verify callback", why: "New callback evidence" })}\n`
	);
	await refreshProjectHookQueue("repo", true);
	writeFileSync(output, "not json\n");
	await refreshProjectHookQueue("repo", true);
	check(
		(await listQueueView()).items.find((i) => i.id === hook.id)?.stale,
		"Failed hook preserves stale attention"
	);
	writeFileSync(
		join(root, "result.json"),
		JSON.stringify({
			unified: true,
			openOnly: true,
			doneUndo: true,
			laterBringBack: true,
			hookCleanup: true,
			staleRetained: true,
			noExternalPosts: true,
		})
	);
	console.log(
		`Native unified queue complete; ${networkCalls} blocked read-only capability attempts.`
	);
	app.exit(0);
}
run().catch(async (error) => {
	console.error(error);
	if (win)
		await win.webContents
			.capturePage()
			.then((image) => writeFileSync(join(root, "failure.png"), image.toPNG()));
	app.exit(1);
});
