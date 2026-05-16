import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { type MemoryOpenQuestion, memoryOpenQuestions } from "../db/schema-memory";
import { ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";

type QuestionStatus = "open" | "answered" | "stale";

export interface AddQuestionInput {
	projectId: string;
	question: string;
	context?: string | null;
}

export function addQuestion(input: AddQuestionInput): { id: string } {
	const id = newMemoryId("q");
	const now = new Date();
	getDb()
		.insert(memoryOpenQuestions)
		.values({
			id,
			projectId: input.projectId,
			question: input.question,
			context: input.context ?? null,
			status: "open",
			createdAt: now,
		})
		.run();

	ftsUpsert({
		kind: "question",
		refId: id,
		projectId: input.projectId,
		body: ftsBody(input.question, input.context, null),
	});
	return { id };
}

export interface AnswerQuestionInput {
	id: string;
	answer: string;
}

export function answerQuestion(input: AnswerQuestionInput): void {
	const db = getDb();
	const existing = db
		.select()
		.from(memoryOpenQuestions)
		.where(eq(memoryOpenQuestions.id, input.id))
		.get();
	if (!existing) throw new Error(`question not found: ${input.id}`);

	db.update(memoryOpenQuestions)
		.set({
			answer: input.answer,
			status: "answered",
			answeredAt: new Date(),
		})
		.where(eq(memoryOpenQuestions.id, input.id))
		.run();

	ftsUpsert({
		kind: "question",
		refId: input.id,
		projectId: existing.projectId,
		body: ftsBody(existing.question, existing.context, input.answer),
	});
}

export interface ListQuestionsInput {
	projectId: string;
	status?: QuestionStatus;
}

export function listQuestions(input: ListQuestionsInput): MemoryOpenQuestion[] {
	const conds = [eq(memoryOpenQuestions.projectId, input.projectId)];
	if (input.status) conds.push(eq(memoryOpenQuestions.status, input.status));

	return getDb()
		.select()
		.from(memoryOpenQuestions)
		.where(and(...conds))
		.orderBy(desc(memoryOpenQuestions.createdAt))
		.all();
}

function ftsBody(
	q: string,
	ctx: string | null | undefined,
	ans: string | null | undefined
): string {
	return [q, ctx ?? "", ans ?? ""].filter(Boolean).join("\n\n");
}
