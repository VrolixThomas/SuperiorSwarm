import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { type MemoryGoal, memoryGoals } from "../db/schema-memory";
import { ftsDelete, ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";

type GoalStatus = "active" | "done" | "abandoned";

export interface AddGoalInput {
	projectId: string;
	title: string;
	body?: string | null;
}

export function addGoal(input: AddGoalInput): { id: string } {
	const id = newMemoryId("goal");
	const now = new Date();
	getDb()
		.insert(memoryGoals)
		.values({
			id,
			projectId: input.projectId,
			title: input.title,
			body: input.body ?? null,
			status: "active",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	ftsUpsert({
		kind: "goal",
		refId: id,
		projectId: input.projectId,
		body: ftsBody(input.title, input.body),
	});
	return { id };
}

export interface UpdateGoalInput {
	id: string;
	title?: string;
	body?: string | null;
	status?: GoalStatus;
}

export function updateGoal(input: UpdateGoalInput): void {
	const db = getDb();
	const existing = db.select().from(memoryGoals).where(eq(memoryGoals.id, input.id)).get();
	if (!existing) throw new Error(`goal not found: ${input.id}`);

	const next: Partial<MemoryGoal> = {
		title: input.title ?? existing.title,
		body: input.body === undefined ? existing.body : input.body,
		status: input.status ?? existing.status,
		updatedAt: new Date(),
	};

	db.update(memoryGoals).set(next).where(eq(memoryGoals.id, input.id)).run();

	ftsUpsert({
		kind: "goal",
		refId: input.id,
		projectId: existing.projectId,
		body: ftsBody(next.title ?? existing.title, next.body ?? existing.body),
	});
}

export interface ListGoalsInput {
	projectId: string;
	status?: GoalStatus;
}

export function listGoals(input: ListGoalsInput): MemoryGoal[] {
	const db = getDb();
	const where = input.status
		? and(eq(memoryGoals.projectId, input.projectId), eq(memoryGoals.status, input.status))
		: eq(memoryGoals.projectId, input.projectId);
	return db.select().from(memoryGoals).where(where).orderBy(desc(memoryGoals.createdAt)).all();
}

export function deleteGoal(id: string): void {
	const db = getDb();
	const row = db.select().from(memoryGoals).where(eq(memoryGoals.id, id)).get();
	if (!row) return;
	db.delete(memoryGoals).where(eq(memoryGoals.id, id)).run();
	ftsDelete({ kind: "goal", refId: id });
}

function ftsBody(title: string, body: string | null | undefined): string {
	return body ? `${title}\n\n${body}` : title;
}
