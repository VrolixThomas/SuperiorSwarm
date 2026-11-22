import "./preload-electron-mock";
import { afterEach, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import {
	observeValidatedAgentEvent,
	reconcileAgentSources,
	workspaceReporter,
	workspaceSourceId,
} from "../src/main/activity-queue/agent-source";
import { fixProjectHook } from "../src/main/activity-queue/hook-actions";
import { readQueueHookConfig } from "../src/main/activity-queue/hook-config";
import {
	describeProjectHookQueueItem,
	isProjectHookQueueItemCurrent,
	refreshProjectHookQueue,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../src/main/activity-queue/hook-source";
import type { PRFeedbackEvent } from "../src/main/activity-queue/pr-feedback";
import { isPRQueueItemCurrent } from "../src/main/activity-queue/pr-scope";
import { registerExternalQueueAdapter } from "../src/main/activity-queue/queue-view";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import {
	isTicketQueueItemCurrent,
	ticketQueueLinks,
} from "../src/main/activity-queue/ticket-runtime";
import {
	describeTicketQueueItem,
	observeTicketPoll,
} from "../src/main/activity-queue/ticket-source";
import { startTicketQueueWorkspace } from "../src/main/activity-queue/ticket-start";
import { closeDb, getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	aiReviewSettings,
	atlassianAuth,
	crossRepoOrchestrators,
	githubAuth,
	linearAuth,
	projects,
	sessionState,
	terminalSessions,
	ticketBranchLinks,
	workspaces,
} from "../src/main/db/schema";
import { activityQueueSnoozes, activityQueueSources } from "../src/main/db/schema-activity-queue";
import { AgentSessionManager } from "../src/main/services/agent-session-manager";
import { setAgentSessionManager } from "../src/main/services/agent-session-manager-handle";
import { defaultSpawnFn } from "../src/main/services/workspace-service";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import { activityQueueRouter } from "../src/main/trpc/routers/activity-queue";
import type { AgentEvent } from "../src/shared/agent-events";
import type { CachedPR } from "../src/shared/review-types";
import type { TicketQueueFact } from "../src/shared/ticket-queue";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

let feedback: PRFeedbackEvent[] = [];
mock.module("../src/main/activity-queue/pr-feedback-fetch", () => ({
	fetchPRFeedback: async () => feedback,
}));
const { describePRQueueItem, observeScopedPRPoll } = await import(
	"../src/main/activity-queue/pr-source"
);
const caller = activityQueueRouter.createCaller({});
const account = { provider: "linear" as const, accountId: "me", siteId: "linear.app" };
let root: string;
let projectId: string;
let baseWorkspace: string;
let manager: AgentSessionManager;
let stamp: number;
let daemon: {
	isConnected: boolean;
	sessions: { id: string; cwd: string; pid: number }[];
	listSessionsStrict(): Promise<{ id: string; cwd: string; pid: number }[]>;
};
const extraDirectories: string[] = [];
const queue = () => new ActivityQueueService();
const fact = (id: string, more: Partial<TicketQueueFact> = {}): TicketQueueFact => ({
	provider: "linear",
	id,
	identifier: `SUP-${id}`,
	title: "Same task name",
	url: `https://linear.app/fixture/issue/SUP-${id}`,
	groupId: "team",
	groupName: "Fixture team",
	assigneeId: "me",
	state: "unstarted",
	status: { id: "todo", name: "Todo", color: "gray" },
	...more,
});
const comment = (id: string, authorId = "reviewer", createdAt = 10) => ({
	id,
	authorId,
	author: authorId,
	body: `Feedback ${id}`,
	createdAt,
});
function tickets(facts: TicketQueueFact[], showAll = true) {
	observeTicketPoll(
		{
			account,
			facts,
			links: ticketQueueLinks(account),
			showAll,
			observedAt: ++stamp,
		},
		queue()
	);
}
const ticketFacts = () => [
	fact("intake"),
	fact("feedback", { state: "started", comments: [comment("ticket-comment")] }),
];
function pr(number: number, role: "author" | "reviewer"): CachedPR {
	return {
		provider: "github",
		identifier: `owner/repo#${number}`,
		number,
		title: "Same task name",
		state: "open",
		sourceBranch: "feature",
		targetBranch: "main",
		author: { login: role === "author" ? "me" : "reviewer", avatarUrl: "" },
		reviewers: [],
		ciStatus: null,
		commentCount: 0,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		updatedAt: "",
		repoOwner: "owner",
		repoName: "repo",
		projectId,
		role,
		headCommitSha: "head",
	};
}
async function prs() {
	await observeScopedPRPoll(
		[pr(7, "reviewer"), pr(8, "author")],
		new Map([
			[
				"github:owner/repo#7",
				{
					accountId: "me",
					authorAccountId: "reviewer",
					viewerIsReviewer: true,
					state: "open" as const,
					headSha: "head",
					isDraft: false,
					reviewRequested: true,
				},
			],
			[
				"github:owner/repo#8",
				{
					accountId: "me",
					authorAccountId: "me",
					state: "open" as const,
					headSha: "head",
					isDraft: false,
					reviewRequested: false,
				},
			],
		]),
		new Map()
	);
}
async function external() {
	tickets([fact("intake"), fact("feedback", { state: "started", comments: [] })]);
	tickets(ticketFacts());
	feedback = [];
	await prs();
	feedback = [
		{
			id: "review:1",
			authorId: "reviewer",
			author: "Reviewer",
			body: "Review body feedback",
			at: 100,
		},
	];
	await prs();
	mkdirSync(join(root, ".superiorswarm"));
	writeFileSync(
		join(root, ".superiorswarm/queue.yml"),
		'hooks: [{id: check, title: Check, run: "cat output.jsonl"}]'
	);
	writeFileSync(
		join(root, "output.jsonl"),
		JSON.stringify({
			key: "problem",
			title: "Same task name",
			why: "Synthetic check",
			fixPrompt: "Explain this synthetic check. Do not edit files.",
		})
	);
	setProjectHooksEnabled(true);
	trustProjectHooks(projectId, readQueueHookConfig(root).hash);
	await refreshProjectHookQueue(projectId, true);
	expect((await caller.viewList()).items.filter((i) => i.category !== "agents")).toHaveLength(5);
}
async function scope(kind: "repo" | "folder" | "orchestrator" | "coordinator") {
	const id =
		kind === "coordinator"
			? await seedCrossRepoOrchestrator({
					name: "Same task name",
					workDir: root,
					projectIds: [projectId],
				})
			: await seedWorkspace(projectId, {
					name: "Same task name",
					type: "branch",
					isOrchestrator: kind === "orchestrator",
				});
	if (kind === "folder")
		getDb().update(projects).set({ kind: "folder" }).where(eq(projects.id, projectId)).run();
	if (kind === "folder")
		getDb()
			.update(workspaces)
			.set({ type: "folder", folderPath: root })
			.where(eq(workspaces.id, id))
			.run();
	return { id, kind };
}
function chat(
	owner: { id: string; kind: string; cwd?: string },
	provider: "claude" | "codex",
	terminal: string,
	managed = false
) {
	const cwd = owner.cwd ?? root;
	getDb()
		.insert(terminalSessions)
		.values({
			id: terminal,
			workspaceId: owner.id,
			title: "Same task name",
			cwd,
			sortOrder: daemon.sessions.length,
			updatedAt: new Date(),
		})
		.run();
	daemon.sessions.push({ id: terminal, cwd, pid: daemon.sessions.length + 1 });
	const registration = {
		terminalId: terminal,
		workspaceId: owner.id,
		provider,
		providerSessionId: `conversation-${terminal}`,
		skipPermissions: false,
	};
	if (managed) manager.registerManagedSession(registration);
	else manager.registerOwnedSession(registration);
	return (rawEvent: string, turnId: string) => {
		stamp = Math.max(stamp + 1, Date.now() + 1);
		const event: AgentEvent = {
			terminalId: terminal,
			sessionId: terminal,
			workspaceId: owner.id,
			providerSessionId: registration.providerSessionId,
			cwd,
			agent: provider,
			rawEvent,
			turnId,
			timestamp: stamp,
			producerTimestamp: stamp,
			alert: rawEvent === "Stop" ? "task-complete" : "active",
		};
		const accepted = manager.handleAgentEvent(event);
		if (accepted) observeValidatedAgentEvent(accepted);
		return accepted;
	};
}
function report(owner: { id: string; kind: string }, terminal: string) {
	const now = new Date();
	if (owner.kind === "coordinator")
		getDb()
			.update(crossRepoOrchestrators)
			.set({ status: "blocked", needs: "Choose this task's approach", statusUpdatedAt: now })
			.where(eq(crossRepoOrchestrators.id, owner.id))
			.run();
	else
		getDb()
			.update(workspaces)
			.set({ currentPhase: "blocked", needs: "Choose this task's approach", statusUpdatedAt: now })
			.where(eq(workspaces.id, owner.id))
			.run();
	reconcileAgentSources({
		workspaceId: owner.id,
		reportedAt: now.getTime(),
		reporter: workspaceReporter(owner.id, terminal),
	});
}
function receipts() {
	return getDb()
		.select()
		.from(activityQueueSources)
		.all()
		.filter((s) => !s.sourceType.startsWith("agent-"))
		.map((s) => ({
			id: s.sourceId,
			revision: s.revision,
			acknowledgedRevision: s.acknowledgedRevision,
			fingerprint: s.fingerprint,
		}));
}
beforeAll(() => {
	setupTestDb();
	registerExternalQueueAdapter(["ticket-start", "ticket-feedback"], {
		describe: describeTicketQueueItem,
		current: isTicketQueueItemCurrent,
	});
	registerExternalQueueAdapter(["pr-review", "pr-feedback"], {
		describe: describePRQueueItem,
		current: isPRQueueItemCurrent,
	});
	registerExternalQueueAdapter(["project-hook"], {
		describe: describeProjectHookQueueItem,
		current: isProjectHookQueueItemCurrent,
	});
});
beforeEach(async () => {
	for (const table of [
		activityQueueSnoozes,
		activityQueueSources,
		agentSessions,
		agentMessages,
		terminalSessions,
		ticketBranchLinks,
		workspaces,
		crossRepoOrchestrators,
		projects,
		linearAuth,
		githubAuth,
		atlassianAuth,
		sessionState,
		aiReviewSettings,
	])
		getDb().delete(table).run();
	root = realpathSync(mkdtempSync(join(tmpdir(), "combined-queue-")));
	projectId = await seedProject();
	getDb().update(projects).set({ repoPath: root }).where(eq(projects.id, projectId)).run();
	baseWorkspace = await seedWorkspace(projectId, { name: "Same task name", type: "branch" });
	getDb()
		.insert(linearAuth)
		.values({
			id: "linear",
			accountId: "me",
			accessToken: "synthetic",
			refreshToken: "synthetic",
			expiresAt: new Date(Date.now() + 100000),
		})
		.run();
	getDb()
		.insert(githubAuth)
		.values({ id: "github", accountId: "me", accessToken: "synthetic" })
		.run();
	stamp = Date.now();
	daemon = {
		isConnected: true,
		sessions: [],
		async listSessionsStrict() {
			if (!this.isConnected) throw Error("fixture disconnected");
			return this.sessions;
		},
	};
	setDaemonClient(daemon as unknown as DaemonClient);
	manager = new AgentSessionManager({
		daemonClient: daemon as unknown as DaemonClient,
		processController: {
			inspectForeground: async () => ({ status: "missing" }),
			terminateForeground: async () => ({ ok: true }),
		},
		getSettings: () => ({ enabled: false, idleMinutes: 5, keepOrchestratorsAwake: true }),
	});
	setAgentSessionManager(manager);
	await external();
});
afterEach(() => {
	manager.dispose();
	setAgentSessionManager(null);
	setDaemonClient(null);
	setProjectHooksEnabled(false);
	rmSync(root, { recursive: true, force: true });
	for (const dir of extraDirectories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

for (const provider of ["claude", "codex"] as const)
	for (const kind of ["repo", "folder", "orchestrator", "coordinator"] as const) {
		test(`${provider}/${kind}: outside-queue input retires only the exact chat in a mixed queue`, async () => {
			const owner = await scope(kind);
			const deliver = chat(owner, provider, "owner");
			const sibling = chat(owner, provider, "sibling");
			deliver("UserPromptSubmit", "first");
			report(owner, "owner");
			deliver("Stop", "first");
			sibling("UserPromptSubmit", "sibling-first");
			sibling("Stop", "sibling-first");
			const before = await caller.viewList();
			expect(before.items.filter((i) => i.category !== "agents")).toHaveLength(5);
			expect(
				before.items.some((i) => i.target.type === "terminal" && i.target.terminalId === "owner")
			).toBe(true);
			expect(
				before.items.some((i) => i.target.type === "terminal" && i.target.terminalId === "sibling")
			).toBe(true);
			const externalReceipts = receipts();
			sibling("UserPromptSubmit", "sibling-second");
			expect(
				(await caller.viewList()).items.some(
					(i) => i.target.type === "terminal" && i.target.terminalId === "owner"
				)
			).toBe(true);
			deliver("UserPromptSubmit", "second");
			const after = await caller.viewList();
			expect(after.items.filter((i) => i.category === "agents")).toHaveLength(0);
			expect(after.totalPending).toBe(5);
			expect(receipts()).toEqual(externalReceipts);
			closeDb();
			expect((await caller.viewList()).totalPending).toBe(5);
			deliver("Stop", "second");
			expect((await caller.viewList()).totalPending).toBe(6);
			expect(deliver("UserPromptSubmit", "second")).toBeNull();
			expect((await caller.viewList()).totalPending).toBe(6);
		});
	}

test("ticket Start links before chat attention and feedback cleanup remains independent", async () => {
	const intake = (await caller.viewList()).items.find((i) => i.kind === "ticket-start")!;
	const untouched = (await caller.viewList()).items
		.filter((i) => i.id !== intake.id)
		.map((i) => ({ id: i.id, revision: i.revision }));
	let createdId = "";
	await startTicketQueueWorkspace(
		{ projectId, branch: "feature/mixed-start", queueTicket: intake },
		async () => {
			createdId = await seedWorkspace(projectId, { name: "Started ticket", type: "branch" });
			return {
				workspaceId: createdId,
				projectId,
				worktreeId: "synthetic-worktree",
				path: root,
				branch: "feature/mixed-start",
				baseBranch: "main",
				reusedExistingBranch: false,
				createdAt: new Date(),
				updatedAt: new Date(),
				artifact: {
					kind: "superiorswarm.workspace.created",
					workspaceId: createdId,
					projectId,
					branch: "feature/mixed-start",
					worktreePath: root,
				},
			};
		}
	);
	expect(ticketQueueLinks(account).get("intake")?.workspaceId).toBe(createdId);
	expect((await caller.viewList()).items.map((i) => ({ id: i.id, revision: i.revision }))).toEqual(
		untouched
	);
	const owner = { id: createdId, kind: "repo" };
	const deliver = chat(owner, "codex", "started-chat");
	deliver("UserPromptSubmit", "first");
	deliver("Stop", "first");
	expect((await caller.viewList()).totalPending).toBe(5);
	tickets([
		fact("intake", { comments: [] }),
		fact("feedback", { state: "started", comments: [comment("ticket-comment")] }),
	]);
	tickets([
		fact("intake", { comments: [comment("new-own-feedback", "reviewer", 30)] }),
		fact("feedback", { state: "started", comments: [comment("ticket-comment")] }),
	]);
	const withFeedback = await caller.viewList();
	expect(
		withFeedback.items
			.filter((i) => i.target.type === "ticket" && i.target.ticketId === "intake")
			.map((i) => i.kind)
	).toEqual(["ticket-feedback"]);
	expect(withFeedback.totalPending).toBe(6);
	deliver("UserPromptSubmit", "second");
	expect((await caller.viewList()).totalPending).toBe(5);
	tickets([
		fact("intake", {
			comments: [comment("new-own-feedback", "reviewer", 30), comment("outside-reply", "me", 31)],
		}),
		fact("feedback", { state: "started", comments: [comment("ticket-comment")] }),
	]);
	expect((await caller.viewList()).totalPending).toBe(4);
	expect(queue().read(workspaceSourceId(createdId))?.candidate).toBeNull();
	closeDb();
	expect((await caller.viewList()).totalPending).toBe(4);
	expect(ticketQueueLinks(account).get("intake")?.workspaceId).toBe(createdId);
});

test("mixed Done/Later/new feedback and account switches preserve unrelated receipts", async () => {
	const owner = { id: baseWorkspace, kind: "repo" };
	const deliver = chat(owner, "claude", "chat");
	deliver("UserPromptSubmit", "one");
	deliver("Stop", "one");
	const first = await caller.viewList();
	expect(first.totalPending).toBe(6);
	const agent = first.items.find((i) => i.category === "agents")!;
	const ticket = first.items.find((i) => i.kind === "ticket-feedback")!;
	const review = first.items.find((i) => i.kind === "pr-review")!;
	await caller.viewLater({ ...agent, untilChange: true });
	await caller.viewLater({ ...ticket, untilChange: true });
	await caller.viewDone(review);
	expect(await caller.viewList()).toMatchObject({ totalPending: 3, laterCount: 2 });
	closeDb();
	expect(await caller.viewList()).toMatchObject({ totalPending: 3, laterCount: 2 });
	expect((await caller.viewList({ view: "later" })).items.map((i) => i.id).sort()).toEqual(
		[agent.id, ticket.id].sort()
	);
	tickets([
		fact("intake"),
		fact("feedback", {
			state: "started",
			comments: [comment("ticket-comment"), comment("next", "reviewer", 20)],
		}),
	]);
	expect(await caller.viewList()).toMatchObject({ totalPending: 4, laterCount: 1 });
	expect((await caller.viewDone(ticket)).status).toBe("conflict");
	getDb().update(linearAuth).set({ accountId: "different" }).run();
	expect((await caller.viewList()).items.filter((i) => i.category === "tickets")).toHaveLength(0);
	expect(await caller.viewList()).toMatchObject({ totalPending: 2, laterCount: 1 });
	expect(
		(await caller.viewDone({ id: ticket.id, revision: queue().read(ticket.id)!.revision })).status
	).toBe("conflict");
	getDb().update(linearAuth).set({ accountId: "me" }).run();
	expect(await caller.viewList()).toMatchObject({ totalPending: 4, laterCount: 1 });
	expect((await caller.viewUndoDone(review)).status).toBe("restored");
	expect((await caller.viewBringBack(agent)).status).toBe("restored");
	expect(await caller.viewList()).toMatchObject({ totalPending: 6, laterCount: 0 });
});

test("hook Fix coexists with external feedback and existing managed attention", async () => {
	const owner = { id: baseWorkspace, kind: "repo" };
	const deliver = chat(owner, "claude", "managed", true);
	deliver("UserPromptSubmit", "first");
	deliver("Stop", "first");
	const before = await caller.viewList();
	const hook = before.items.find((i) => i.kind === "project-hook")!;
	const externalReceipts = receipts();
	getDb().insert(aiReviewSettings).values({ id: "default", cliPreset: "claude" }).run();
	const result = await fixProjectHook(
		{ ...hook, workspaceId: baseWorkspace },
		{
			confirm: async () => true,
			spawn: async (args) => {
				const prepared = await defaultSpawnFn(args);
				if (prepared.launch) extraDirectories.push(dirname(prepared.launch.scriptPath));
				return prepared;
			},
		}
	);
	expect(result.status).toBe("prepared");
	if (result.status !== "prepared") throw Error("Expected prepared launch");
	expect(manager.getSession("managed")?.managed).toBe(true);
	const fresh = manager.getSession(result.launch.terminalId)!;
	expect(fresh.managed).toBe(false);
	daemon.sessions.push({ id: result.launch.terminalId, cwd: root, pid: 99 });
	stamp = Math.max(stamp + 1, Date.now() + 1);
	const accepted = manager.handleAgentEvent({
		terminalId: fresh.terminalId,
		sessionId: fresh.terminalId,
		workspaceId: baseWorkspace,
		providerSessionId: fresh.providerSessionId!,
		agent: "claude",
		cwd: root,
		rawEvent: "Stop",
		turnId: "fix-turn",
		alert: "task-complete",
		timestamp: stamp,
		producerTimestamp: stamp,
	});
	expect(accepted).not.toBeNull();
	if (accepted) observeValidatedAgentEvent(accepted);
	expect((await caller.viewList()).items.filter((i) => i.category === "agents")).toHaveLength(2);
	expect(receipts()).toEqual(externalReceipts);
	writeFileSync(join(root, "output.jsonl"), "");
	await refreshProjectHookQueue(projectId, true);
	const after = await caller.viewList();
	expect(after.items.some((i) => i.id === hook.id)).toBe(false);
	expect(after.items.filter((i) => i.category === "agents")).toHaveLength(2);
	expect(after.items.filter((i) => i.category === "tickets")).toHaveLength(2);
	expect(after.items.filter((i) => i.category === "prs")).toHaveLength(2);
});

test("daemon loss marks only chats stale; external actions and cleanup remain available", async () => {
	const deliver = chat({ id: baseWorkspace, kind: "repo" }, "codex", "disconnect-chat");
	deliver("UserPromptSubmit", "one");
	deliver("Stop", "one");
	const initial = await caller.viewList();
	expect(initial.totalPending).toBe(6);
	const agent = initial.items.find((i) => i.category === "agents")!;
	const ticket = initial.items.find((i) => i.kind === "ticket-start")!;
	daemon.isConnected = false;
	const offline = await caller.viewList();
	expect(offline.agentStatusAvailable).toBe(false);
	expect(offline.items.find((i) => i.id === agent.id)?.stale).toBe(true);
	expect(offline.items.filter((i) => i.category !== "agents").every((i) => !i.stale)).toBe(true);
	expect((await caller.viewDone(agent)).status).toBe("conflict");
	expect((await caller.viewDone(ticket)).status).toBe("acknowledged");
	expect((await caller.viewList()).totalPending).toBe(5);
	expect((await caller.viewUndoDone(ticket)).status).toBe("restored");
	daemon.isConnected = true;
	expect((await caller.viewList()).items.find((i) => i.id === agent.id)?.stale).toBe(false);
	expect((await caller.viewList()).totalPending).toBe(6);
});

test("same-name workspaces in separate projects reject mixed receipts and retain each other's work", async () => {
	const otherProject = await seedProject();
	const otherRoot = join(root, "other");
	mkdirSync(otherRoot);
	getDb()
		.update(projects)
		.set({ repoPath: otherRoot, name: "Same project name" })
		.where(eq(projects.id, otherProject))
		.run();
	getDb()
		.update(projects)
		.set({ name: "Same project name" })
		.where(eq(projects.id, projectId))
		.run();
	const otherWorkspace = await seedWorkspace(otherProject, {
		name: "Same task name",
		type: "branch",
	});
	const first = chat({ id: baseWorkspace, kind: "repo" }, "claude", "project-one");
	const second = chat({ id: otherWorkspace, kind: "repo", cwd: otherRoot }, "codex", "project-two");
	first("UserPromptSubmit", "one");
	first("Stop", "one");
	second("UserPromptSubmit", "one");
	second("Stop", "one");
	const items = (await caller.viewList()).items;
	const own = items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === "project-one"
	)!;
	const other = items.find(
		(i) => i.target.type === "terminal" && i.target.terminalId === "project-two"
	)!;
	const ticket = items.find((i) => i.kind === "ticket-start")!;
	expect(
		(
			await caller.viewDone({
				...own,
				members: [
					{ id: own.id, revision: own.revision },
					{ id: other.id, revision: other.revision },
				],
			})
		).status
	).toBe("conflict");
	expect(
		(await caller.viewDone({ ...ticket, members: [{ id: own.id, revision: own.revision }] })).status
	).toBe("conflict");
	expect((await caller.viewList()).totalPending).toBe(7);
	expect((await caller.viewDone(own)).status).toBe("acknowledged");
	expect((await caller.viewList()).items.some((i) => i.id === other.id)).toBe(true);
	expect((await caller.viewList()).totalPending).toBe(6);
	const filtered = await caller.viewList({ projectId: otherProject });
	expect(filtered.items.map((i) => i.id)).toEqual([other.id]);
	second("UserPromptSubmit", "two");
	expect((await caller.viewList()).totalPending).toBe(5);
	expect((await caller.viewUndoDone(own)).status).toBe("restored");
	expect((await caller.viewList()).totalPending).toBe(6);
});
