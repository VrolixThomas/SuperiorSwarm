import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { ActivityQueueTarget } from "../../shared/activity-queue";
import { getDb } from "../db";
import { activityQueueDeliveries } from "../db/schema-activity-queue";
/** Bound cleanup, not consumption proof. The next observed prompt may be unrelated;
 * conservatively protect every report newer than a pending Queue intent. */
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
		for (const row of pending)
			if (!row.continuationTurnId && promptHash === row.fingerprint)
				db.update(activityQueueDeliveries)
					.set({ continuationTurnId: turnId })
					.where(eq(activityQueueDeliveries.requestId, row.requestId))
					.run();
		return Math.min(eventTime, ...pending.map((row) => row.createdAt));
	});
}
