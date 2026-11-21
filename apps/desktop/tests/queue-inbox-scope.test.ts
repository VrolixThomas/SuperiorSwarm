import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { workspaceReporter } from "../src/main/activity-queue/agent-source";
import { queueEntities } from "../src/main/activity-queue/entities";
import { getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	crossRepoOrchestratorProjects,
	crossRepoOrchestrators,
	projects,
	terminalSessions,
} from "../src/main/db/schema";
import {
	type CallerContext,
	acknowledgeQuestionAnswers,
	readMessages,
} from "../src/main/services/workspace-service";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);

async function inbox(coordinator: boolean) {
	const projectId = await seedProject();
	const id = coordinator
		? await seedCrossRepoOrchestrator({ projectIds: [projectId] })
		: await seedWorkspace(projectId, { name: "Bound inbox" });
	for (const name of ["owner", "sibling"]) {
		const terminalId = `${id}-${name}`;
		getDb()
			.insert(terminalSessions)
			.values({
				id: terminalId,
				workspaceId: id,
				title: name,
				cwd: "/tmp",
				sortOrder: 0,
				updatedAt: new Date(),
			})
			.run();
		getDb()
			.insert(agentSessions)
			.values({
				terminalId,
				workspaceId: id,
				entityKind: coordinator ? "coordinator" : "workspace",
				provider: "codex",
				providerSessionId: `conversation-${terminalId}`,
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();
	}
	const owner = workspaceReporter(id, `${id}-owner`);
	const sibling = workspaceReporter(id, `${id}-sibling`);
	if (!owner || !sibling) throw new Error("Missing fixture identity");
	const ctx: CallerContext = coordinator
		? { kind: "xro", xroId: id, linkedProjectIds: [projectId], terminalId: owner.terminalId }
		: { kind: "workspace", workspaceId: id, projectId, terminalId: owner.terminalId };
	function insert(
		key: string,
		recipient: typeof owner,
		stamp: number,
		kind: "answer" | "note" = "answer",
		scope = projectId
	) {
		const messageId = `${id}-${key}`;
		getDb()
			.insert(agentMessages)
			.values({
				id: messageId,
				projectId: scope,
				toWorkspaceId: id,
				recipient,
				kind,
				content: key,
				createdAt: new Date(stamp),
			})
			.run();
		return messageId;
	}
	return { id, projectId, ctx, owner, sibling, insert };
}

for (const coordinator of [false, true]) {
	test(`${coordinator ? "coordinator" : "workspace"}: sibling-only rows are filtered before the bounded inbox limit`, async () => {
		const f = await inbox(coordinator);
		const wanted = f.insert("wanted", f.owner, 100);
		getDb().transaction(() => {
			for (let n = 0; n < 201; n++) f.insert(`sibling-${n}`, f.sibling, 200 + n);
		});
		const messages = (
			await readMessages({ ...f.ctx, deferQueueRetrieval: true }, { includeBroadcasts: false })
		).messages;
		expect(messages.map((row) => row.id)).toEqual([wanted]);
		expect(
			getDb()
				.select()
				.from(agentMessages)
				.where(and(eq(agentMessages.toWorkspaceId, f.id), isNull(agentMessages.retrievedAt)))
				.all()
		).toHaveLength(202);
	});
	test(`${coordinator ? "coordinator" : "workspace"}: unread exact answers drain deterministically beyond 200 without acknowledging unreturned rows`, async () => {
		const f = await inbox(coordinator);
		const own: string[] = [];
		getDb().transaction(() => {
			for (let n = 0; n < 205; n++)
				own.push(f.insert(`answer-${String(n).padStart(3, "0")}`, f.owner, 100));
			for (let n = 0; n < 201; n++) {
				f.insert(`history-${n}`, null, 1000 + n, "note");
				f.insert(`sibling-${n}`, f.sibling, 2000 + n);
			}
		});
		// Poll cursors must not strand older pending answers; ordinary history still obeys since.
		const first = await readMessages(
			{ ...f.ctx, deferQueueRetrieval: true },
			{ includeBroadcasts: false, since: new Date(500).toISOString() }
		);
		expect(first.messages.map((row) => row.id)).toEqual(own.slice(0, 200));
		expect(
			(
				await readMessages(
					{ ...f.ctx, deferQueueRetrieval: true },
					{ includeBroadcasts: false, since: new Date(500).toISOString() }
				)
			).messages
		).toEqual(first.messages);
		expect(
			getDb()
				.select()
				.from(agentMessages)
				.where(and(eq(agentMessages.toWorkspaceId, f.id), isNull(agentMessages.retrievedAt)))
				.all()
		).toHaveLength(607);
		expect(
			acknowledgeQuestionAnswers(
				f.ctx,
				first.messages.map((row) => row.id)
			).retrieved
		).toEqual(own.slice(0, 200));
		for (const id of own.slice(200))
			expect(
				getDb().select().from(agentMessages).where(eq(agentMessages.id, id)).get()?.retrievedAt
			).toBeNull();
		const second = await readMessages(
			{ ...f.ctx, deferQueueRetrieval: true },
			{ includeBroadcasts: false, since: new Date(500).toISOString() }
		);
		expect(second.messages).toHaveLength(200);
		expect(second.messages.slice(0, 5).map((row) => row.id)).toEqual(own.slice(200));
		expect(second.messages.every((row) => !row.content.startsWith("sibling-"))).toBe(true);
		acknowledgeQuestionAnswers(
			f.ctx,
			second.messages.map((row) => row.id)
		);
		for (const id of own)
			expect(
				getDb().select().from(agentMessages).where(eq(agentMessages.id, id)).get()?.retrievedAt
			).toBeTruthy();
		expect(
			getDb()
				.select()
				.from(agentMessages)
				.where(eq(agentMessages.id, `${f.id}-sibling-0`))
				.get()?.retrievedAt
		).toBeNull();
		const legacy = await readMessages(
			{ ...f.ctx, terminalId: undefined },
			{ includeBroadcasts: false }
		);
		expect(legacy.messages).toHaveLength(200);
		expect(legacy.messages.every((row) => row.kind === "note")).toBe(true);
	});
	test(`${coordinator ? "coordinator" : "workspace"}: wrong generation/provider/entity/project is never visible or retrieved`, async () => {
		const f = await inbox(coordinator);
		const foreign = await seedProject();
		f.insert("wrong-generation", { ...f.owner, providerSessionId: "different" }, 1000);
		f.insert("wrong-provider", { ...f.owner, provider: "claude" }, 1000);
		f.insert(
			"wrong-entity",
			{ ...f.owner, entity: { kind: coordinator ? "workspace" : "coordinator", id: f.id } },
			1000
		);
		f.insert(
			"wrong-id",
			{ ...f.owner, entity: { kind: coordinator ? "coordinator" : "workspace", id: "different" } },
			1000
		);
		f.insert("wrong-project", f.owner, 1000, "answer", foreign);
		const valid = f.insert("valid", f.owner, 10);
		const legacy = f.insert("legacy", null, 20, "note");
		const rows = (await readMessages(f.ctx, { includeBroadcasts: false })).messages;
		expect(rows.map((row) => row.id).sort()).toEqual([valid, legacy].sort());
		expect(
			getDb().select().from(agentMessages).where(eq(agentMessages.id, valid)).get()?.retrievedAt
		).toBeTruthy();
		for (const key of [
			"wrong-generation",
			"wrong-provider",
			"wrong-entity",
			"wrong-id",
			"wrong-project",
			"legacy",
		])
			expect(
				getDb()
					.select()
					.from(agentMessages)
					.where(eq(agentMessages.id, `${f.id}-${key}`))
					.get()?.retrievedAt
			).toBeNull();
	});
}

test("all-project coordinator scope follows current inventory and keeps its own directory", async () => {
	const repo = await seedProject();
	const folder = await seedProject();
	getDb().update(projects).set({ kind: "folder" }).where(eq(projects.id, folder)).run();
	const coordinator = await seedCrossRepoOrchestrator({
		projectIds: [],
		workDir: "/tmp/own-coordinator",
	});
	getDb()
		.update(crossRepoOrchestrators)
		.set({ accessScope: "all" })
		.where(eq(crossRepoOrchestrators.id, coordinator))
		.run();
	const first = queueEntities().get(coordinator)?.context;
	expect(first?.projectId).toBeUndefined();
	expect(first?.projectPath).toBe("/tmp/own-coordinator");
	expect(first?.linkedProjects?.find((row) => row.id === repo)?.kind).toBe("repo");
	expect(first?.linkedProjects?.find((row) => row.id === folder)?.kind).toBe("folder");
	const added = await seedProject();
	expect(
		queueEntities()
			.get(coordinator)
			?.context.linkedProjects?.map((row) => row.id)
	).toContain(added);
	getDb().delete(projects).where(eq(projects.id, added)).run();
	expect(
		queueEntities()
			.get(coordinator)
			?.context.linkedProjects?.map((row) => row.id)
	).not.toContain(added);
});

test("selected coordinator scope stays limited to current explicit links", async () => {
	const linked = await seedProject();
	const unlinked = await seedProject();
	const coordinator = await seedCrossRepoOrchestrator({
		projectIds: [linked],
		workDir: "/tmp/selected-coordinator",
	});
	expect(
		queueEntities()
			.get(coordinator)
			?.context.linkedProjects?.map((row) => row.id)
	).toEqual([linked]);
	await seedProject();
	expect(
		queueEntities()
			.get(coordinator)
			?.context.linkedProjects?.map((row) => row.id)
	).not.toContain(unlinked);
	getDb()
		.delete(crossRepoOrchestratorProjects)
		.where(eq(crossRepoOrchestratorProjects.orchestratorId, coordinator))
		.run();
	expect(queueEntities().get(coordinator)?.context.linkedProjects).toEqual([]);
	expect(queueEntities().get(coordinator)?.context.projectPath).toBe("/tmp/selected-coordinator");
});
