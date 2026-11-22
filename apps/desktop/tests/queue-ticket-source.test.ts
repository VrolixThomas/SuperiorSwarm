import "./preload-electron-mock";
import { beforeAll, beforeEach, expect, test } from "bun:test";
import { ActivityQueueService } from "../src/main/activity-queue/service";
import { readTicketQueueDetail } from "../src/main/activity-queue/ticket-detail";
import {
	type TicketQueueTransport,
	fetchTicketQueueComments,
	fetchTicketQueueFacts,
} from "../src/main/activity-queue/ticket-fetch";
import {
	currentTicketQueueAccounts,
	isTicketQueueItemCurrent,
	prepareTicketQueueAction,
	recordTicketQueueLink,
	refreshTicketQueue,
	stopTicketQueue,
	ticketLinkAccount,
	ticketQueueLinks,
} from "../src/main/activity-queue/ticket-runtime";
import {
	describeTicketQueueItem,
	markTicketPollUnavailable,
	observeTicketPoll,
} from "../src/main/activity-queue/ticket-source";
import { closeDb, getDb } from "../src/main/db";
import { atlassianAuth, linearAuth, sessionState, ticketBranchLinks } from "../src/main/db/schema";
import { activityQueueSources } from "../src/main/db/schema-activity-queue";
import {
	type TicketQueueAccount,
	type TicketQueueComment,
	type TicketQueueFact,
	type TicketQueueLink,
	ticketQueueSourceId,
} from "../src/shared/ticket-queue";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
const account: TicketQueueAccount = { provider: "linear", accountId: "me", siteId: "linear.app" };
const jira: TicketQueueAccount = { provider: "jira", accountId: "me", siteId: "site-a" };
const fact = (overrides: Partial<TicketQueueFact> = {}): TicketQueueFact => ({
	provider: "linear",
	id: "uuid-1",
	identifier: "SUP-1",
	title: "Fix a queue",
	url: "https://linear.app/swarm/issue/SUP-1",
	groupId: "team-1",
	groupName: "Swarm",
	status: { id: "todo", name: "Todo", color: "gray" },
	assigneeId: "me",
	state: "unstarted",
	...overrides,
});
const comment = (id: string, authorId = "other", createdAt = 10): TicketQueueComment => ({
	id,
	authorId,
	createdAt,
	author: authorId,
	body: `Please check ${id}`,
});
let now = 1;
let queue: ActivityQueueService;
function poll(
	facts: TicketQueueFact[],
	options: {
		showAll?: boolean;
		account?: TicketQueueAccount;
		links?: Map<string, TicketQueueLink>;
	} = {}
) {
	observeTicketPoll(
		{
			account: options.account ?? account,
			facts,
			links: options.links ?? new Map(),
			showAll: options.showAll ?? false,
			observedAt: now++,
		},
		queue
	);
}
beforeAll(setupTestDb);
beforeEach(() => {
	for (const table of [
		activityQueueSources,
		linearAuth,
		atlassianAuth,
		sessionState,
		ticketBranchLinks,
	])
		getDb().delete(table).run();
	queue = new ActivityQueueService();
	now = 1;
});
test("silent baseline, later assignment, title-only enrichment, exact Done and durable restart", () => {
	poll([fact()]);
	expect(queue.list().items).toHaveLength(0);
	poll([fact(), fact({ id: "new", title: "New task" })]);
	const item = queue.list().items[0]!;
	expect(item.kind).toBe("ticket-start");
	poll([fact(), fact({ id: "new", title: "Renamed task" })]);
	expect(queue.list().items[0]?.revision).toBe(item.revision);
	expect(queue.list().items[0]?.title).toContain("Renamed task");
	expect(queue.acknowledge(item).status).toBe("acknowledged");
	closeDb();
	queue = new ActivityQueueService();
	poll([fact(), fact({ id: "new", title: "Still renamed" })]);
	expect(queue.list().items).toHaveLength(0);
});
test("show-all includes old assignments; reassignment reopens and links resolve", () => {
	poll([fact()]);
	poll([fact()], { showAll: true });
	const initial = queue.list().items[0]!;
	poll([fact({ assigneeId: "someone" })]);
	expect(queue.list().items).toHaveLength(0);
	poll([fact()]);
	expect(queue.list().items[0]?.revision).toBeGreaterThan(initial.revision);
	expect(queue.acknowledge(initial).status).toBe("conflict");
	poll([fact()], {
		links: new Map([
			["uuid-1", { workspaceId: "w", workspaceName: "w", projectId: "p", projectName: "repo" }],
		]),
	});
	expect(queue.list().items).toHaveLength(0);
});
test("failed reads retain candidates; only complete absence clears", () => {
	poll([]);
	poll([fact()]);
	const item = queue.list().items[0]!;
	markTicketPollUnavailable(account, "offline", queue);
	expect(queue.list().items[0]?.stale).toBe(true);
	expect(queue.list().items[0]?.revision).toBe(item.revision);
	poll([fact()]);
	expect(queue.list().items[0]?.stale).toBe(false);
	poll([]);
	expect(queue.list().items).toHaveLength(0);
});
test("feedback baseline/self suppression, outside-queue self reply cleanup, fresh revision after Done", () => {
	poll([fact({ state: "started", comments: [comment("history")] })]);
	poll([fact({ state: "started", comments: [comment("history"), comment("self", "me", 12)] })]);
	expect(queue.list().items).toHaveLength(0);
	poll([fact({ state: "started", comments: [comment("new", "other", 20)] })]);
	const first = queue.list().items[0]!;
	expect(first.kind).toBe("ticket-feedback");
	expect(describeTicketQueueItem(first)?.why).toContain("Please check new");
	queue.acknowledge(first);
	poll([fact({ state: "started", comments: [comment("new", "other", 20)] })]);
	expect(queue.list().items).toHaveLength(0);
	poll([fact({ state: "started", comments: [comment("next", "other", 30)] })]);
	expect(queue.list().items[0]?.revision).toBeGreaterThan(first.revision);
	poll([fact({ state: "started", comments: [comment("reply", "me", 31)] })]);
	expect(queue.list().items).toHaveLength(0);
});
test("unknown author is not feedback; comment failures preserve unread feedback", () => {
	poll([fact({ state: "started", comments: [] })]);
	poll([fact({ state: "started", comments: [{ ...comment("unknown"), authorId: null }] })]);
	expect(queue.list().items).toHaveLength(0);
	poll([fact({ state: "started", comments: [comment("new")] })]);
	const first = queue.list().items[0]!;
	poll([fact({ state: "started", commentsError: "offline" })]);
	expect(queue.list().items[0]?.revision).toBe(first.revision);
	expect(queue.list().items[0]?.stale).toBe(true);
	poll([fact({ state: "started", assigneeId: "someone", comments: [] })]);
	expect(queue.list().items).toHaveLength(0);
});
test("same Jira key across sites/accounts never shares baseline or receipt", () => {
	const issue = fact({ provider: "jira", id: "SUP-1" });
	poll([], { account: jira });
	poll([issue], { account: jira });
	const siteA = queue.list().items[0]!;
	const siteB = { ...jira, siteId: "site-b" };
	poll([issue], { account: siteB });
	expect(queue.list().items).toHaveLength(1);
	poll([issue], { account: siteB, showAll: true });
	expect(queue.list().items).toHaveLength(2);
	queue.acknowledge(siteA);
	expect(queue.list().items[0]?.id).toBe(ticketQueueSourceId(siteB, "SUP-1"));
});
function authenticateJira(siteId = "site-a") {
	getDb()
		.insert(atlassianAuth)
		.values({
			service: "jira",
			accountId: "me",
			cloudId: siteId,
			accessToken: "fixture",
			refreshToken: "fixture",
			expiresAt: new Date(),
		})
		.onConflictDoUpdate({ target: atlassianAuth.service, set: { cloudId: siteId } })
		.run();
}
test("account switch blocks actions; legacy Jira links cannot clear; explicit scoped link resolves", async () => {
	authenticateJira();
	poll([], { account: jira });
	poll([fact({ provider: "jira", id: "SUP-1" })], { account: jira });
	const item = queue.list().items[0]!;
	expect(currentTicketQueueAccounts()).toHaveLength(1);
	expect(isTicketQueueItemCurrent(item)).toBe(true);
	expect(prepareTicketQueueAction({ ...item, action: "open" }).target.ticketId).toBe("SUP-1");
	expect(queue.list().items).toHaveLength(1);
	const projectId = await seedProject();
	const workspaceId = await seedWorkspace(projectId, { name: "same-name", isOrchestrator: true });
	getDb()
		.insert(ticketBranchLinks)
		.values({ id: "link", workspaceId, provider: "jira", ticketId: "SUP-1", createdAt: new Date() })
		.run();
	expect(ticketQueueLinks(jira).size).toBe(0);
	recordTicketQueueLink(jira, "SUP-1", workspaceId);
	expect(queue.list().items).toHaveLength(0);
	expect(ticketQueueLinks(jira).get("SUP-1")?.workspaceId).toBe(workspaceId);
	expect(ticketQueueLinks({ ...jira, siteId: "other" }).size).toBe(0);
	authenticateJira("site-b");
	expect(isTicketQueueItemCurrent(item)).toBe(false);
	expect(() => prepareTicketQueueAction({ ...item, action: "open" })).toThrow();
	getDb().delete(atlassianAuth).run();
	expect(currentTicketQueueAccounts()).toHaveLength(0);
});
const unavailable = async (): Promise<never> => {
	throw new Error("wrong provider");
};
test("Linear transport paginates fresh snapshot and refuses repeated cursors", async () => {
	let page = 0;
	const node = {
		id: "uuid-1",
		identifier: "SUP-1",
		title: "Fix",
		url: "https://linear.app/swarm/issue/SUP-1",
		state: { id: "todo", name: "Todo", color: "gray", type: "unstarted" },
		team: { id: "team-1", name: "Swarm" },
		assignee: { id: "me" },
	};
	const transport: TicketQueueTransport = {
		jira: unavailable,
		linear: async (_query, variables) => {
			expect(variables.account).toBe("me");
			page++;
			return {
				issues: {
					nodes: page === 1 ? [node] : [],
					pageInfo: { hasNextPage: page === 1, endCursor: "next" },
				},
			};
		},
	};
	const facts = await fetchTicketQueueFacts(account, undefined, transport);
	poll([]);
	poll(facts);
	expect(queue.list().items[0]?.kind).toBe("ticket-start");
	expect(page).toBe(2);
	transport.linear = async () => ({
		issues: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } },
	});
	await expect(fetchTicketQueueFacts(account, undefined, transport)).rejects.toThrow("pagination");
});
test("Jira comments retain authors/mentions; incomplete pages fail closed", async () => {
	const urls: string[] = [];
	const transport: TicketQueueTransport = {
		linear: unavailable,
		jira: async (url) => {
			urls.push(url);
			const startAt = urls.length - 1;
			return {
				startAt,
				total: 2,
				comments: [
					{
						id: String(startAt),
						author: { accountId: "other", displayName: "Alex" },
						body: { content: [{ text: "Please check" }, { attrs: { text: "@Thomas" } }] },
						created: "2026-11-22T00:00:00Z",
					},
				],
			};
		},
	};
	const comments = await fetchTicketQueueComments(jira, "SUP-1", transport);
	expect(comments).toHaveLength(2);
	expect(comments[0]?.body).toContain("@Thomas");
	expect(comments[0]?.authorId).toBe("other");
	expect(urls[1]).toContain("startAt=1");
	expect(urls[0]).toContain("/site-a/");
	transport.jira = async () => ({ startAt: 0, total: 2, comments: [] });
	await expect(fetchTicketQueueComments(jira, "SUP-1", transport)).rejects.toThrow("pagination");
});

test("a silently baselined ticket reassigned back after absence appears", () => {
	poll([fact()]);
	poll([]);
	poll([fact()]);
	expect(queue.list().items[0]?.kind).toBe("ticket-start");
});
test("feedback stays resolved on return until a new external comment after new baseline", () => {
	poll([fact({ state: "started", comments: [] })]);
	poll([fact({ state: "started", comments: [comment("old")] })]);
	expect(queue.list().items).toHaveLength(1);
	poll([]);
	poll([fact({ state: "started", comments: [comment("old")] })]);
	expect(queue.list().items).toHaveLength(0);
	poll([fact({ state: "started", comments: [comment("old"), comment("new", "other", 11)] })]);
	expect(queue.list().items).toHaveLength(1);
});

test("ordinary ticket linking verifies observed Jira site instead of a bare key", () => {
	authenticateJira();
	getDb().update(atlassianAuth).set({ siteUrl: "https://a.atlassian.net" }).run();
	expect(ticketLinkAccount("jira", "SUP-1", "https://a.atlassian.net/browse/SUP-1")).toMatchObject(
		jira
	);
	expect(() => ticketLinkAccount("jira", "SUP-1", "https://b.atlassian.net/browse/SUP-1")).toThrow(
		"different Jira site"
	);
	expect(() =>
		ticketLinkAccount("jira", "SUP-1", "https://a.atlassian.net/browse/SUP-2")
	).toThrow();
	expect(ticketLinkAccount("jira", "SUP-1")).toBeUndefined();
});

test("runtime refresh uses complete provider transport and retains state on errors", async () => {
	authenticateJira();
	let nodes: unknown[] = [];
	let fail = false;
	const transport: TicketQueueTransport = {
		linear: unavailable,
		jira: async () => {
			if (fail) throw Error("offline");
			return { issues: nodes, isLast: true };
		},
	};
	await refreshTicketQueue(transport);
	nodes = [
		{
			key: "SUP-39",
			fields: {
				summary: "Queue task",
				status: { id: "todo", name: "Todo", statusCategory: { key: "new" } },
				priority: null,
				issuetype: { name: "Task" },
				project: { key: "SUP" },
				created: "2026-11-22",
				updated: "2026-11-22",
				assignee: { accountId: "me", displayName: "Me" },
			},
		},
	];
	await refreshTicketQueue(transport);
	expect(queue.list().items[0]?.kind).toBe("ticket-start");
	fail = true;
	await refreshTicketQueue(transport);
	expect(queue.list().items[0]?.stale).toBe(true);
	fail = false;
	nodes = [];
	await refreshTicketQueue(transport);
	expect(queue.list().items).toHaveLength(0);
});

test("shutdown invalidates in-flight provider results before DB writes", async () => {
	authenticateJira();
	let release: ((value: unknown) => void) | undefined;
	const transport: TicketQueueTransport = {
		linear: unavailable,
		jira: () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	};
	const pending = refreshTicketQueue(transport);
	stopTicketQueue();
	if (!release) throw Error("transport did not start");
	release({ issues: [], isLast: true });
	await pending;
	expect(getDb().select().from(activityQueueSources).all()).toHaveLength(0);
});

test("in-app ticket details are account bound and reading never handles the occurrence", async () => {
	authenticateJira();
	poll([], { account: jira });
	poll([fact({ provider: "jira", id: "SUP-1" })], { account: jira });
	const sourceId = ticketQueueSourceId(jira, "SUP-1");
	const destination = { ...jira, sourceId, ticketId: "SUP-1" };
	const reads = {
		description: async () => ({ description: "Actual task requirements" }),
		comments: async () => [comment("feedback")],
	};
	const detail = await readTicketQueueDetail(destination, reads);
	expect(detail.description).toBe("Actual task requirements");
	expect(detail.comments[0]?.id).toBe("feedback");
	expect(queue.list().items).toHaveLength(1);
	await expect(readTicketQueueDetail({ ...destination, siteId: "wrong" }, reads)).rejects.toThrow(
		"account or site"
	);
	await expect(
		readTicketQueueDetail(destination, {
			...reads,
			description: async () => {
				authenticateJira("other-site");
				return { description: "must not leak" };
			},
		})
	).rejects.toThrow("could not be loaded");
	expect(queue.list().items).toHaveLength(1);
});
