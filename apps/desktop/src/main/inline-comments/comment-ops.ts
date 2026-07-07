import { and, eq, inArray } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { InlineComment } from "../../shared/inline-comment-types";
import { inlineComments } from "../db/schema";

export interface CreateCommentInput {
	id: string;
	workspaceId: string;
	repoPath: string;
	filePath: string;
	startLine: number;
	endLine: number;
	codeSnapshot: string;
	body: string;
}

export function createComment(db: BunSQLiteDatabase<any>, input: CreateCommentInput): void {
	db.insert(inlineComments)
		.values({ ...input, status: "pending", createdAt: new Date(), sentAt: null })
		.run();
}

export function listPendingComments(
	db: BunSQLiteDatabase<any>,
	workspaceId: string
): InlineComment[] {
	return db
		.select()
		.from(inlineComments)
		.where(and(eq(inlineComments.workspaceId, workspaceId), eq(inlineComments.status, "pending")))
		.all();
}

export function updateCommentBody(
	db: BunSQLiteDatabase<any>,
	input: { id: string; body: string }
): void {
	db.update(inlineComments).set({ body: input.body }).where(eq(inlineComments.id, input.id)).run();
}

export function deleteComment(db: BunSQLiteDatabase<any>, id: string): void {
	db.delete(inlineComments).where(eq(inlineComments.id, id)).run();
}

export function markCommentsSent(db: BunSQLiteDatabase<any>, ids: string[]): void {
	if (ids.length === 0) return;
	db.update(inlineComments)
		.set({ status: "sent", sentAt: new Date() })
		.where(inArray(inlineComments.id, ids))
		.run();
}
