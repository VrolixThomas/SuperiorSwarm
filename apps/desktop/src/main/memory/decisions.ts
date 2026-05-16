import { and, desc, eq, gt } from "drizzle-orm";
import { getDb } from "../db";
import { type MemoryDecision, memoryDecisions } from "../db/schema-memory";
import { ftsUpsert } from "./fts";
import { newMemoryId } from "./ids";

export interface LogDecisionInput {
	projectId: string;
	title: string;
	rationale: string;
	alternatives?: string | null;
}

export function logDecision(input: LogDecisionInput): { id: string } {
	const id = newMemoryId("dec");
	const now = new Date();
	getDb()
		.insert(memoryDecisions)
		.values({
			id,
			projectId: input.projectId,
			title: input.title,
			rationale: input.rationale,
			alternatives: input.alternatives ?? null,
			createdAt: now,
		})
		.run();

	const body = [input.title, input.rationale, input.alternatives ?? ""]
		.filter(Boolean)
		.join("\n\n");
	ftsUpsert({
		kind: "decision",
		refId: id,
		projectId: input.projectId,
		body,
	});
	return { id };
}

export interface ListDecisionsInput {
	projectId: string;
	since?: Date;
	limit?: number;
}

export function listDecisions(input: ListDecisionsInput): MemoryDecision[] {
	const conds = [eq(memoryDecisions.projectId, input.projectId)];
	if (input.since) conds.push(gt(memoryDecisions.createdAt, input.since));

	return getDb()
		.select()
		.from(memoryDecisions)
		.where(and(...conds))
		.orderBy(desc(memoryDecisions.createdAt))
		.limit(input.limit ?? 100)
		.all();
}
