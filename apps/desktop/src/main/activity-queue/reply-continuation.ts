import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { ActivityQueueTarget } from "../../shared/activity-queue";
import { getDb } from "../db";
import { activityQueueDeliveries } from "../db/schema-activity-queue";
/** Content-correlated cleanup and a separate one-turn ambiguity guard.
 * A missing digest never establishes a delivery receipt. */
export function queueReplyContinuationTime(
	target: Extract<ActivityQueueTarget, { type: "terminal" }>,
	turnId: string,
	eventTime: number,
	promptHash?: string
): number {
	const db = getDb();
	return db.transaction(() => {
		const pending = db
			.select()
			.from(activityQueueDeliveries)
			.where(
				and(
					inArray(activityQueueDeliveries.state, ["reserved", "admitted", "uncertain"]),
					or(
						isNull(activityQueueDeliveries.continuationTurnId),
						eq(activityQueueDeliveries.continuationTurnId, turnId)
					)
				)
			)
			.all()
			.filter((row) => {
				const t = row.target;
				return (
					t.type === "terminal" &&
					t.workspaceId === target.workspaceId &&
					t.entity?.kind === target.entity?.kind &&
					t.terminalId === target.terminalId &&
					t.provider === target.provider &&
					t.providerSessionId === target.providerSessionId
				);
			});
		let ceiling = eventTime;
		for (const row of pending) {
			if (eventTime < row.createdAt) continue;
			const matched = promptHash === row.fingerprint;
			const knownReplay = row.continuationTurnId === turnId;
			// Explicitly different content is an unrelated manual prompt. Missing digests
			// get ONE conservative cleanup guard, never a lifetime sticky receipt.
			const ambiguous =
				!promptHash && (!row.cleanupProtectedTurnId || row.cleanupProtectedTurnId === turnId);
			if (matched || knownReplay || ambiguous) ceiling = Math.min(ceiling, row.createdAt);
			if (matched && !row.continuationTurnId)
				db.update(activityQueueDeliveries)
					.set({ continuationTurnId: turnId })
					.where(eq(activityQueueDeliveries.requestId, row.requestId))
					.run();
			if (ambiguous && !row.cleanupProtectedTurnId)
				db.update(activityQueueDeliveries)
					.set({ cleanupProtectedTurnId: turnId })
					.where(eq(activityQueueDeliveries.requestId, row.requestId))
					.run();
		}
		return ceiling;
	});
}
