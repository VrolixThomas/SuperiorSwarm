import { and, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { reviewViewed } from "../db/schema";

export interface SetViewedInput {
	workspaceId: string;
	filePath: string;
	contentHash: string;
}

export function setViewed(db: BunSQLiteDatabase<any>, input: SetViewedInput): void {
	const now = new Date();
	db.insert(reviewViewed)
		.values({
			workspaceId: input.workspaceId,
			filePath: input.filePath,
			contentHash: input.contentHash,
			viewedAt: now,
		})
		.onConflictDoUpdate({
			target: [reviewViewed.workspaceId, reviewViewed.filePath],
			set: { contentHash: input.contentHash, viewedAt: now },
		})
		.run();
}

export function unsetViewed(
	db: BunSQLiteDatabase<any>,
	input: { workspaceId: string; filePath: string }
): void {
	db.delete(reviewViewed)
		.where(
			and(
				eq(reviewViewed.workspaceId, input.workspaceId),
				eq(reviewViewed.filePath, input.filePath)
			)
		)
		.run();
}

export function getViewed(
	db: BunSQLiteDatabase<any>,
	workspaceId: string
): Array<{ filePath: string; contentHash: string; viewedAt: Date }> {
	return db
		.select({
			filePath: reviewViewed.filePath,
			contentHash: reviewViewed.contentHash,
			viewedAt: reviewViewed.viewedAt,
		})
		.from(reviewViewed)
		.where(eq(reviewViewed.workspaceId, workspaceId))
		.all();
}
