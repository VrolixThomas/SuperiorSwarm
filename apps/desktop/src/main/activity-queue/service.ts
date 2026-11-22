import { eq } from "drizzle-orm";
import type {
	ActivityQueueAcknowledgeResult,
	ActivityQueueItem,
	ActivityQueueListInput,
	ActivityQueueListResult,
	ActivityQueueObservation,
	ActivityQueueSource,
} from "../../shared/activity-queue";
import { getDb } from "../db";
import { activityQueueSources } from "../db/schema-activity-queue";

const priority = {
	"agent-input": 0,
	"pr-review": 1,
	"pr-update": 2,
	"agent-ready": 3,
	"pr-feedback": 1,
	"ticket-start": 2,
	"ticket-feedback": 1,
	"project-hook": 2,
};
function item(source: ActivityQueueSource): ActivityQueueItem | null {
	return source.candidate
		? {
				...source.candidate,
				id: source.sourceId,
				revision: source.revision,
				acknowledged: source.acknowledgedRevision === source.revision,
				stale: source.error !== null,
			}
		: null;
}

export class ActivityQueueService {
	constructor(private readonly db = getDb()) {}

	read(sourceId: string): ActivityQueueSource | null {
		return (
			this.db
				.select()
				.from(activityQueueSources)
				.where(eq(activityQueueSources.sourceId, sourceId))
				.get() ?? null
		);
	}

	/** Synchronous SQLite transaction: baseline, projection and revision move together. */
	observe(observation: ActivityQueueObservation): ActivityQueueSource {
		return this.db.transaction(() => {
			const previous = this.read(observation.sourceId);
			// A delayed observation must not overwrite a newer source snapshot.
			if (previous && observation.observedAt < previous.observedAt) return previous;
			const changed =
				!previous ||
				previous.fingerprint !== observation.fingerprint ||
				Boolean(previous.candidate) !== Boolean(observation.candidate);
			const next: ActivityQueueSource = {
				...observation,
				candidate:
					observation.candidate && !changed && previous?.candidate
						? { ...observation.candidate, occurredAt: previous.candidate.occurredAt }
						: observation.candidate,
				revision: (previous?.revision ?? 0) + (changed ? 1 : 0),
				acknowledgedRevision: previous?.acknowledgedRevision ?? null,
				error: null,
			};
			this.db
				.insert(activityQueueSources)
				.values(next)
				.onConflictDoUpdate({
					target: activityQueueSources.sourceId,
					set: next,
				})
				.run();
			return next;
		});
	}

	/** Resolve attention while retaining its durable adapter baseline. */
	resolve(sourceId: string, observedAt = Date.now()): ActivityQueueSource | null {
		const previous = this.read(sourceId);
		return previous ? this.observe({ ...previous, candidate: null, observedAt }) : null;
	}

	/** A failed fetch never clears a candidate or overwrites a known snapshot. */
	markUnavailable(sourceId: string, error: string): void {
		this.db
			.update(activityQueueSources)
			.set({ error })
			.where(eq(activityQueueSources.sourceId, sourceId))
			.run();
	}

	list(
		input: ActivityQueueListInput = {},
		isCurrent: (item: ActivityQueueItem) => boolean = () => true
	): ActivityQueueListResult {
		const sources = this.db.select().from(activityQueueSources).all();
		const allItems = sources.flatMap((source) => {
			const value = item(source);
			return value && isCurrent(value) ? [value] : [];
		});
		const visible = allItems.filter(
			(value) =>
				(input.includeAcknowledged || !value.acknowledged) &&
				(!input.projectId || value.projectId === input.projectId) &&
				(!input.kinds?.length || input.kinds.includes(value.kind))
		);
		const pendingIds = new Set(
			visible.filter((value) => !value.acknowledged).map((value) => value.id)
		);
		return {
			items: visible.sort(
				(a, b) =>
					priority[a.kind] - priority[b.kind] ||
					b.occurredAt - a.occurredAt ||
					a.id.localeCompare(b.id)
			),
			totalPending: allItems.filter((value) => !value.acknowledged).length,
			updatedAt: sources.length ? Math.max(...sources.map((source) => source.observedAt)) : null,
			sourceErrors: sources.flatMap((source) =>
				source.error && pendingIds.has(source.sourceId)
					? [{ sourceId: source.sourceId, error: source.error, observedAt: source.observedAt }]
					: []
			),
		};
	}

	acknowledge(input: { id: string; revision: number }): ActivityQueueAcknowledgeResult {
		return this.db.transaction(() => {
			const source = this.read(input.id);
			if (!source) return { status: "not-found" };
			if (source.revision !== input.revision || !source.candidate)
				return { status: "conflict", item: item(source) };
			this.db
				.update(activityQueueSources)
				.set({ acknowledgedRevision: input.revision })
				.where(eq(activityQueueSources.sourceId, input.id))
				.run();
			return {
				status: "acknowledged",
				item: {
					...source.candidate,
					id: source.sourceId,
					revision: source.revision,
					acknowledged: true,
					stale: source.error !== null,
				},
			};
		});
	}
}

export function getActivityQueueService(): ActivityQueueService {
	return new ActivityQueueService();
}
