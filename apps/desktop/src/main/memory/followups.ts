import { type SQL, and, asc, eq, gt, lt } from "drizzle-orm";
import { getDb } from "../db";
import { type MemoryFollowup, memoryFollowups } from "../db/schema-memory";
import { newMemoryId } from "./ids";

type FollowupStatus = "open" | "done" | "cancelled";

export interface AddFollowupInput {
	projectId: string;
	title: string;
	body?: string | null;
	owner?: string | null;
	dueAt?: Date | null;
	goalId?: string | null;
}

export function addFollowup(input: AddFollowupInput): { id: string } {
	const id = newMemoryId("fu");
	const now = new Date();
	getDb()
		.insert(memoryFollowups)
		.values({
			id,
			projectId: input.projectId,
			goalId: input.goalId ?? null,
			title: input.title,
			body: input.body ?? null,
			owner: input.owner ?? null,
			dueAt: input.dueAt ?? null,
			status: "open",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { id };
}

export interface UpdateFollowupInput {
	id: string;
	title?: string;
	body?: string | null;
	owner?: string | null;
	dueAt?: Date | null;
	status?: FollowupStatus;
	goalId?: string | null;
}

export function updateFollowup(input: UpdateFollowupInput): void {
	const db = getDb();
	const existing = db.select().from(memoryFollowups).where(eq(memoryFollowups.id, input.id)).get();
	if (!existing) throw new Error(`followup not found: ${input.id}`);

	db.update(memoryFollowups)
		.set({
			title: input.title ?? existing.title,
			body: input.body === undefined ? existing.body : input.body,
			owner: input.owner === undefined ? existing.owner : input.owner,
			dueAt: input.dueAt === undefined ? existing.dueAt : input.dueAt,
			status: input.status ?? existing.status,
			goalId: input.goalId === undefined ? existing.goalId : input.goalId,
			updatedAt: new Date(),
		})
		.where(eq(memoryFollowups.id, input.id))
		.run();
}

export interface ListFollowupsInput {
	projectId: string;
	status?: FollowupStatus;
	owner?: string;
	dueBefore?: Date;
	dueAfter?: Date;
}

export function listFollowups(input: ListFollowupsInput): MemoryFollowup[] {
	const conds: SQL[] = [eq(memoryFollowups.projectId, input.projectId)];
	if (input.status) conds.push(eq(memoryFollowups.status, input.status));
	if (input.owner) conds.push(eq(memoryFollowups.owner, input.owner));
	if (input.dueBefore) conds.push(lt(memoryFollowups.dueAt, input.dueBefore));
	if (input.dueAfter) conds.push(gt(memoryFollowups.dueAt, input.dueAfter));

	return getDb()
		.select()
		.from(memoryFollowups)
		.where(and(...conds))
		.orderBy(asc(memoryFollowups.dueAt), asc(memoryFollowups.createdAt))
		.all();
}
