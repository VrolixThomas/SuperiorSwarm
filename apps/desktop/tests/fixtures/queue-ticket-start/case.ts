import "../../preload-electron-mock";
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ActivityQueueService } from "../../../src/main/activity-queue/service";
import { observeTicketPoll } from "../../../src/main/activity-queue/ticket-source";
import { closeDb, getDb } from "../../../src/main/db";
import {
	linearAuth,
	sessionState,
	ticketBranchLinks,
	workspaces,
} from "../../../src/main/db/schema";
import { activityQueueSources } from "../../../src/main/db/schema-activity-queue";
import type { CreateWorkspaceRequest } from "../../../src/shared/control-plane";
import { seedProject, setupTestDb } from "../../helpers/db";

const runtime = await import("../../../src/main/activity-queue/ticket-runtime");
mock.module("../../../src/main/activity-queue/ticket-runtime", () => ({
	...runtime,
	refreshTicketQueue: async () => {},
}));
let creates = 0;
let duringCreate: (() => Promise<void>) | undefined;
let failAfterCreate = false;
mock.module("../../../src/main/services/workspace-service", () => ({
	createWorkspace: async (input: CreateWorkspaceRequest) => {
		creates++;
		await duringCreate?.();
		const workspaceId = randomUUID();
		const now = new Date();
		getDb()
			.insert(workspaces)
			.values({
				id: workspaceId,
				projectId: input.projectId,
				type: "worktree",
				name: input.branch,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		if (failAfterCreate) throw new Error("Synthetic failure after workspace creation");
		return { workspaceId, worktreeId: workspaceId, createdAt: now, updatedAt: now };
	},
}));
mock.module("../../../src/main/ai-review/pr-poller", () => ({ getCachedPRs: () => [] }));
const { workspacesRouter } = await import("../../../src/main/trpc/routers/workspaces");
const caller = workspacesRouter.createCaller({});
setupTestDb();
const repoA = await seedProject();
const repoB = await seedProject();
function seed(accountId = "me") {
	for (const table of [activityQueueSources, linearAuth, sessionState, ticketBranchLinks])
		getDb().delete(table).run();
	getDb()
		.insert(linearAuth)
		.values({
			id: "default",
			accountId,
			displayName: "Synthetic",
			accessToken: "synthetic",
			refreshToken: "synthetic",
			expiresAt: new Date(),
		})
		.run();
	const account = { provider: "linear" as const, accountId, siteId: "linear.app" };
	const queue = new ActivityQueueService();
	const base = { account, links: new Map(), showAll: false };
	observeTicketPoll({ ...base, facts: [], observedAt: 1 }, queue);
	observeTicketPoll(
		{
			...base,
			observedAt: 2,
			facts: [
				{
					provider: "linear",
					id: "uuid",
					identifier: "SUP-1",
					title: "Task",
					url: "https://linear.app/a/issue/SUP-1",
					groupId: "team",
					groupName: "Team",
					status: { id: "todo", name: "Todo", color: "gray" },
					assigneeId: accountId,
					state: "unstarted",
				},
			],
		},
		queue
	);
	const item = queue.list().items[0];
	assert(item);
	creates = 0;
	duringCreate = undefined;
	failAfterCreate = false;
	return {
		queue,
		item,
		input: {
			projectId: repoA,
			branch: "feature/a",
			queueTicket: { id: item.id, revision: item.revision },
		},
	};
}
async function concurrency() {
	const { input } = seed();
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	duringCreate = () => held;
	const one = caller.create(input);
	const two = caller.create({ ...input, projectId: repoB, branch: "feature/b" });
	const outcomes = Promise.allSettled([one, two]);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(creates, 1, "Concurrent starts across repositories reserve one occurrence");
	release();
	const result = await outcomes;
	assert.equal(result.filter((value) => value.status === "fulfilled").length, 1);
	assert.equal(
		getDb().select().from(ticketBranchLinks).all().length,
		1,
		"Main links before returning"
	);
	assert.equal(new ActivityQueueService().list().items.length, 0);
	await assert.rejects(caller.create(input));
	assert.equal(creates, 1, "A lost response/repeated receipt cannot create twice");
}
async function acknowledged() {
	const { queue, item, input } = seed();
	queue.acknowledge(item);
	await assert.rejects(caller.create(input), /no longer ready/);
	assert.equal(creates, 0, "Done after opening confirmation must stop creation");
}
async function doneWhileCreating() {
	const { queue, item, input } = seed();
	duringCreate = async () => {
		queue.acknowledge(item);
	};
	await assert.rejects(caller.create(input), /no longer ready/);
	assert.equal(creates, 1);
	assert.equal(getDb().select().from(ticketBranchLinks).all().length, 0);
	await assert.rejects(caller.create(input));
	assert.equal(creates, 1);
}
async function uncertainRestart() {
	const { input } = seed();
	failAfterCreate = true;
	await assert.rejects(caller.create(input), /Synthetic failure after workspace creation/);
	assert.equal(creates, 1);
	closeDb();
	failAfterCreate = false;
	await assert.rejects(caller.create({ ...input, projectId: repoB }), /already requested/);
	assert.equal(creates, 1, "Restart cannot unlock a possibly completed creation");
}
async function switchedAccount() {
	const { input } = seed();
	duringCreate = async () => {
		getDb().update(linearAuth).set({ accountId: "other" }).run();
	};
	await assert.rejects(caller.create(input), /account changed/);
	assert.equal(getDb().select().from(ticketBranchLinks).all().length, 0);
	getDb().update(linearAuth).set({ accountId: "me" }).run();
	duringCreate = undefined;
	await assert.rejects(caller.create(input), /already requested/);
	assert.equal(creates, 1);
}
async function invalidProject() {
	const { input } = seed();
	await assert.rejects(caller.create({ ...input, projectId: "missing" }), /available repository/);
	assert.equal(creates, 0);
	assert.equal(
		getDb()
			.select()
			.from(sessionState)
			.where(
				eq(
					sessionState.key,
					`queue-ticket-start:${input.queueTicket.id}:${input.queueTicket.revision}`
				)
			)
			.all().length,
		0
	);
	await caller.create(input);
	assert.equal(creates, 1);
}
try {
	for (const run of [
		concurrency,
		acknowledged,
		doneWhileCreating,
		uncertainRestart,
		switchedAccount,
		invalidProject,
	]) {
		await run();
		console.log(`PASS: ${run.name}`);
	}
} finally {
	closeDb();
}
