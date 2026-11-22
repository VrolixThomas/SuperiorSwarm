import "./preload-electron-mock";
import { afterEach, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { questionSourceId, workspaceReporter } from "../src/main/activity-queue/agent-source";
import {
	type AnswerContinuationTransport,
	workspaceAnswerAndContinue,
	workspaceAnswerContinuationCapability,
	workspaceAnswerContinuationReceipt,
} from "../src/main/activity-queue/answer-continuation";
import { markAnswerPromptReceived } from "../src/main/activity-queue/answer-continuation-receipts";
import { isAnswerContinuation } from "../src/main/activity-queue/question-answers";
import { listWorkspaceQueue, workspaceAnswer } from "../src/main/activity-queue/workspace-queue";
import { getDb } from "../src/main/db";
import {
	agentMessages,
	agentSessions,
	projects,
	terminalSessions,
	workspaces,
} from "../src/main/db/schema";
import { activityQueueDeliveries } from "../src/main/db/schema-activity-queue";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import type {
	WorkspaceQueueReplyInput,
	WorkspaceQueueReplyResult,
} from "../src/shared/activity-queue";
import { answerContinuationPrompt } from "../src/shared/queue-answer-continuation";
import { seedCrossRepoOrchestrator, seedProject, seedWorkspace, setupTestDb } from "./helpers/db";
import { cleanupAnswerFixtures, ownAnswerFixture } from "./helpers/queue-answer-cleanup";

beforeAll(setupTestDb);
afterEach(() => {
	setDaemonClient(null);
	cleanupAnswerFixtures();
});
const digest = (content: string) => createHash("sha256").update(content).digest("hex");
async function fixture(provider: "claude" | "codex" = "codex", scope = "worktree") {
	const db = getDb();
	const projectId = await seedProject();
	if (scope === "folder")
		db.update(projects).set({ kind: "folder" }).where(eq(projects.id, projectId)).run();
	const workspaceId =
		scope === "coordinator"
			? await seedCrossRepoOrchestrator({ projectIds: [projectId] })
			: await seedWorkspace(projectId, {
					name: "Saved answer",
					isOrchestrator: scope === "orchestrator",
				});
	ownAnswerFixture(projectId, workspaceId);
	if (scope === "folder")
		db.update(workspaces)
			.set({ type: "folder", folderPath: "/tmp" })
			.where(eq(workspaces.id, workspaceId))
			.run();
	for (const suffix of ["owner", "sibling"]) {
		const id = `${workspaceId}-${suffix}`;
		db.insert(terminalSessions)
			.values({ id, workspaceId, title: suffix, cwd: "/tmp", sortOrder: 0, updatedAt: new Date() })
			.run();
		db.insert(agentSessions)
			.values({
				terminalId: id,
				workspaceId,
				entityKind: scope === "coordinator" ? "coordinator" : "workspace",
				provider,
				providerSessionId: `chat-${id}`,
				state: "idle",
				createdAt: new Date(),
				updatedAt: new Date(),
			})
			.run();
	}
	const owner = workspaceReporter(workspaceId, `${workspaceId}-owner`);
	const sibling = workspaceReporter(workspaceId, `${workspaceId}-sibling`);
	if (!owner || !sibling) throw Error("Fixture owner missing");
	const questionId = crypto.randomUUID();
	const siblingQuestion = crypto.randomUUID();
	for (const [id, reporter] of [
		[questionId, owner],
		[siblingQuestion, sibling],
	] as const)
		db.insert(agentMessages)
			.values({
				id,
				projectId,
				fromWorkspaceId: workspaceId,
				toWorkspaceId: null,
				reporter,
				kind: "question",
				content: "Which color?",
				createdAt: new Date(),
			})
			.run();
	setDaemonClient({
		isConnected: true,
		listSessionsStrict: async () =>
			[owner, sibling].map((target) => ({ id: target.terminalId, cwd: "/tmp", pid: 1 })),
	} as unknown as DaemonClient);
	const item = (await listWorkspaceQueue()).items.find(
		(item) => item.id === questionSourceId(questionId)
	);
	if (!item) throw Error("Missing question item");
	const input = {
		id: item.id,
		revision: item.revision,
		questionId,
		requestId: crypto.randomUUID(),
		content: "Use blue",
	};
	const submissions: WorkspaceQueueReplyInput[] = [];
	let outcome: WorkspaceQueueReplyResult | Error = {
		status: "admitted",
		requestId: input.requestId,
		detail: "Submitted",
	};
	const transport: AnswerContinuationTransport = {
		capability: async () => ({ status: "available", mode: "reply", detail: "Ready" }),
		submit: async (request) => {
			submissions.push(request);
			if (outcome instanceof Error) throw outcome;
			db.insert(activityQueueDeliveries)
				.values({
					requestId: request.requestId,
					occurrenceKey: `${request.id}:${request.revision}`,
					fingerprint: digest(request.content),
					target: owner,
					members: [{ id: request.id, revision: request.revision }],
					state: "admitted",
					createdAt: Date.now(),
				})
				.onConflictDoNothing()
				.run();
			return outcome;
		},
		receipt: (requestId) => ({ status: "admitted", requestId, detail: "Recorded submission" }),
	};
	return {
		input,
		owner,
		sibling,
		questionId,
		siblingQuestion,
		transport,
		submissions,
		setOutcome: (value: typeof outcome) => {
			outcome = value;
		},
		answers: () =>
			db.select().from(agentMessages).where(eq(agentMessages.inReplyTo, questionId)).all(),
	};
}

for (const provider of ["claude", "codex"] as const)
	for (const scope of ["worktree", "folder", "orchestrator", "coordinator"])
		test(`${provider}/${scope}: save then continue binds exact answer; matching accepted prompt retrieves only that question`, async () => {
			const f = await fixture(provider, scope);
			const result = await workspaceAnswerAndContinue(f.input, f.transport);
			expect(result.answer?.delivery).toBe("saved");
			expect(result.continuation.status).toBe("admitted");
			expect(f.answers()).toHaveLength(1);
			expect(f.answers()[0]?.retrievedAt).toBeNull();
			const answerId = result.answer?.messageId;
			if (!answerId) throw Error("Answer missing");
			const prompt = answerContinuationPrompt({ questionId: f.questionId, answerId }, "Use blue");
			expect(f.submissions[0]?.content).toBe(prompt);
			expect(
				markAnswerPromptReceived(
					{ questionId: f.questionId, answerId },
					f.sibling,
					Date.now() + 10,
					digest(prompt)
				)
			).toBe(false);
			expect(
				markAnswerPromptReceived(
					{ questionId: f.questionId, answerId },
					f.owner,
					Date.now() + 10,
					digest(prompt)
				)
			).toBe(true);
			const rows = (await listWorkspaceQueue()).items;
			expect(rows.some((item) => item.id === f.input.id)).toBe(false);
			expect(rows.some((item) => item.id === questionSourceId(f.siblingQuestion))).toBe(true);
		});
test("saved answer is reused on retry and recovery never mutates or resends", async () => {
	const f = await fixture();
	const saved = await workspaceAnswer(f.input);
	expect(saved.status).toBe("saved");
	const first = await workspaceAnswerAndContinue(f.input, f.transport);
	expect(first.answer?.messageId).toBe(saved.status === "saved" ? saved.messageId : undefined);
	await workspaceAnswerAndContinue(f.input, f.transport);
	expect(f.answers()).toHaveLength(1);
	expect(f.submissions).toHaveLength(1);
	const answerId = first.answer?.messageId;
	if (!answerId) throw Error("Missing saved id");
	expect(
		workspaceAnswerContinuationReceipt({ ...f.input, answerId }, f.transport).continuation.status
	).toBe("admitted");
	expect(
		workspaceAnswerContinuationReceipt({ ...f.input, answerId, requestId: "missing" }, f.transport)
			.continuation.status
	).toBe("uncertain");
	expect(f.submissions).toHaveLength(1);
});
test("partial failure retains saved answer and no receipt remains uncertain", async () => {
	const f = await fixture();
	f.setOutcome(Error("Disconnected"));
	const result = await workspaceAnswerAndContinue(f.input, f.transport);
	expect(result.answer?.delivery).toBe("saved");
	expect(result.continuation.status).toBe("uncertain");
	expect(f.answers()).toHaveLength(1);
	const answerId = result.answer?.messageId;
	if (!answerId) throw Error("Missing saved id");
	expect(
		workspaceAnswerContinuationReceipt({ ...f.input, answerId }, f.transport).continuation.status
	).toBe("uncertain");
	expect(f.submissions).toHaveLength(1);
});
test("different saved content and reused request identity fail without creating another answer", async () => {
	const first = await fixture();
	await workspaceAnswerAndContinue(first.input, first.transport);
	expect(
		(await workspaceAnswerAndContinue({ ...first.input, content: "Use red" }, first.transport))
			.continuation.status
	).toBe("conflict");
	expect(first.submissions).toHaveLength(1);
	const other = await fixture();
	expect(
		(
			await workspaceAnswerAndContinue(
				{ ...other.input, requestId: first.input.requestId },
				other.transport
			)
		).continuation.status
	).toBe("conflict");
	expect(other.answers()).toHaveLength(0);
	expect(other.submissions).toHaveLength(0);
});
test("answer consumed outside Queue is not continued a second time", async () => {
	const f = await fixture();
	const result = await workspaceAnswer(f.input);
	if (result.status !== "saved") throw Error("Save failed");
	getDb()
		.update(agentMessages)
		.set({ retrievedAt: new Date() })
		.where(eq(agentMessages.id, result.messageId))
		.run();
	const continued = await workspaceAnswerAndContinue(
		{ ...f.input, answerId: result.messageId },
		f.transport
	);
	expect(continued.answer?.delivery).toBe("retrieved");
	expect(continued.continuation.status).toBe("not-needed");
	expect(f.submissions).toHaveLength(0);
});
test("old prompt digest cannot mark edited answer or replaced conversation retrieved", async () => {
	const f = await fixture();
	const result = await workspaceAnswerAndContinue(f.input, f.transport);
	const answerId = result.answer?.messageId;
	if (!answerId) throw Error("Save missing");
	const prompt = f.submissions[0]?.content;
	if (!prompt) throw Error("Prompt missing");
	getDb()
		.update(agentMessages)
		.set({ content: "Edited later" })
		.where(eq(agentMessages.id, answerId))
		.run();
	expect(
		markAnswerPromptReceived(
			{ questionId: f.questionId, answerId },
			f.owner,
			Date.now() + 10,
			digest(prompt)
		)
	).toBe(false);
	getDb()
		.update(agentMessages)
		.set({ content: "Use blue" })
		.where(eq(agentMessages.id, answerId))
		.run();
	getDb()
		.update(agentSessions)
		.set({ providerSessionId: "replacement" })
		.where(eq(agentSessions.terminalId, f.owner.terminalId))
		.run();
	expect(
		markAnswerPromptReceived(
			{ questionId: f.questionId, answerId },
			f.owner,
			Date.now() + 10,
			digest(prompt)
		)
	).toBe(false);
	expect(f.answers()[0]?.retrievedAt).toBeNull();
});
test("oversized encoded continuation saves but never truncates or submits", async () => {
	const f = await fixture();
	const content = "\u202e".repeat(16000);
	const result = await workspaceAnswerAndContinue({ ...f.input, content }, f.transport);
	expect(result.answer?.content).toBe(content);
	expect(result.continuation.status).toBe("unavailable");
	expect(f.submissions).toHaveLength(0);
});

test("independent retrieval while admission waits returns not-needed without duplicate delivery", async () => {
	const f = await fixture();
	f.transport.submit = async (request) => {
		f.submissions.push(request);
		const answer = f.answers()[0];
		if (!answer) throw Error("Missing answer");
		getDb()
			.update(agentMessages)
			.set({ retrievedAt: new Date() })
			.where(eq(agentMessages.id, answer.id))
			.run();
		return { status: "rejected", reason: "Already retrieved" };
	};
	const result = await workspaceAnswerAndContinue(f.input, f.transport);
	expect(result.answer?.delivery).toBe("retrieved");
	expect(result.continuation.status).toBe("not-needed");
	expect(f.answers()).toHaveLength(1);
	expect(f.submissions).toHaveLength(1);
});

test("capability rechecks persisted envelope size after save", async () => {
	const f = await fixture();
	await workspaceAnswer({ ...f.input, content: "‮".repeat(16000) });
	let checks = 0;
	f.transport.capability = async () => {
		checks++;
		return { status: "available", mode: "reply", detail: "Ready" };
	};
	const result = await workspaceAnswerContinuationCapability(f.input, f.transport);
	expect(result.status).toBe("unavailable");
	expect(checks).toBe(0);
});

test("a forged or changed displayed member receipt cannot save or continue an answer", async () => {
	const f = await fixture();
	const result = await workspaceAnswerAndContinue(
		{
			...f.input,
			members: [
				{ id: f.input.id, revision: f.input.revision },
				{ id: "other-occurrence", revision: 3 },
			],
		},
		f.transport
	);
	expect(result.answer).toBeNull();
	expect(f.answers()).toHaveLength(0);
	expect(f.submissions).toHaveLength(0);
});

test("a matching old prompt does not retrieve a question after a conflicting answer was saved", async () => {
	const f = await fixture();
	const result = await workspaceAnswerAndContinue(f.input, f.transport);
	const answerId = result.answer?.messageId;
	if (!answerId) throw Error("Missing answer");
	const first = f.answers()[0];
	if (!first) throw Error("Missing answer row");
	getDb()
		.insert(agentMessages)
		.values({
			...first,
			id: crypto.randomUUID(),
			content: "A later different answer",
			createdAt: new Date(),
		})
		.run();
	const prompt = f.submissions[0]?.content;
	if (!prompt) throw Error("Missing submitted prompt");
	expect(
		markAnswerPromptReceived(
			{ questionId: f.questionId, answerId },
			f.owner,
			Date.now() + 10,
			digest(prompt)
		)
	).toBe(false);
	expect(f.answers().every((answer) => answer.retrievedAt === null)).toBe(true);
	expect((await listWorkspaceQueue()).items.some((item) => item.id === f.input.id)).toBe(true);
});

test("continuation matching refuses missing conversation and inconsistent entity or sender identity", async () => {
	const f = await fixture();
	await workspaceAnswerAndContinue(f.input, f.transport);
	const answer = f.answers()[0];
	const question = getDb()
		.select()
		.from(agentMessages)
		.where(eq(agentMessages.id, f.questionId))
		.get();
	if (!answer || !question) throw Error("Missing messages");
	const unknown = { ...f.owner, providerSessionId: null };
	expect(
		isAnswerContinuation(
			{ ...question, reporter: unknown },
			{ ...answer, recipient: unknown },
			unknown
		)
	).toBe(false);
	const inconsistent = { ...f.owner, entity: { kind: "workspace" as const, id: "another-entity" } };
	expect(
		isAnswerContinuation(
			{ ...question, reporter: inconsistent },
			{ ...answer, recipient: inconsistent },
			inconsistent
		)
	).toBe(false);
	expect(
		isAnswerContinuation(
			{ ...question, fromWorkspaceId: "another-workspace" },
			{ ...answer, toWorkspaceId: "another-workspace" },
			f.owner
		)
	).toBe(false);
});
