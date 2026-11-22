import type { ReviewSnapshotRevision } from "../../shared/review-snapshot-types";

const attempts = new Map<string, { promise: Promise<void>; settled: boolean }>();
const listeners = new Set<() => void>();
let refresh = 0;
export const snapshotAcquisitionRefresh = () => refresh;
export const subscribeSnapshotAcquisitionRefresh = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** Only explicit Refresh permits another attempt; polling and remounts cannot retry a failed fetch. */
export function resetReviewSnapshotAcquisition(workspaceId: string) {
	for (const [key, attempt] of attempts)
		if (attempt.settled && (JSON.parse(key) as ReviewSnapshotRevision).workspaceId === workspaceId)
			attempts.delete(key);
	refresh++;
	for (const listener of listeners) listener();
}

export function acquireSnapshotOnce(
	input: ReviewSnapshotRevision,
	acquire: () => Promise<unknown>
): Promise<void> {
	const key = JSON.stringify(input);
	const prior = attempts.get(key);
	if (prior) return prior.promise;
	const entry = { promise: Promise.resolve(), settled: false };
	entry.promise = Promise.resolve()
		.then(acquire)
		.then(() => {})
		.finally(() => {
			entry.settled = true;
		});
	attempts.set(key, entry);
	return entry.promise;
}
