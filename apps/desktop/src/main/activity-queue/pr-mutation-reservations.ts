import { like } from "drizzle-orm";
import type { QueuePROrigin, QueuePRPublication } from "../../shared/queue-pr-publication";
import { getDb } from "../db";
import { sessionState } from "../db/schema";
/** Direct approval and review-mode publication share the same occurrence boundary. */
export function assertPRMutationAvailable(origin: QueuePROrigin, operation?: QueuePRPublication) {
	for (const row of getDb()
		.select()
		.from(sessionState)
		.where(like(sessionState.key, "queue-pr-%"))
		.all()) {
		if (!row.key.startsWith("queue-pr-review:") && !row.key.startsWith("queue-pr-publication:"))
			continue;
		const receipt = JSON.parse(row.value) as {
			id?: string;
			revision?: number;
			origin?: QueuePROrigin;
			status: string;
			expiresAt: number;
			operation?: QueuePRPublication;
			outcome?: { verdictSubmitted?: boolean };
		};
		const source = receipt.origin ?? receipt;
		if (source.id !== origin.id || source.revision !== origin.revision) continue;
		if (receipt.status === "attempted")
			throw new Error(
				"An earlier publication has an unknown outcome. Inspect the provider before another submission."
			);
		if (
			(receipt.status === "pending" && receipt.expiresAt > Date.now()) ||
			(receipt.status === "submitted" &&
				(!receipt.operation ||
					receipt.outcome?.verdictSubmitted ||
					JSON.stringify(receipt.operation) === JSON.stringify(operation)))
		)
			throw new Error("This occurrence already has a publication reservation.");
	}
}
