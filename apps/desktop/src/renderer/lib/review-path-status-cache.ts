import { useSyncExternalStore } from "react";
import type { ReviewPathSnapshot } from "../../shared/review-path-runtime";
import type { ReviewPathStatusScope } from "../../shared/review-path-status";

const records = new Map<string, { snapshot: ReviewPathSnapshot; observedAt: number }>();
const listeners = new Set<() => void>();
function key(s: ReviewPathStatusScope) {
	return JSON.stringify([s.provider, s.owner, s.repo, s.prNumber, s.headSha]);
}
/** A queue can retain the exact workspace the user just visited while its read-only lookup loads. */
export function rememberReviewPath(snapshot: ReviewPathSnapshot) {
	records.set(key(snapshot.identity), { snapshot, observedAt: Date.now() });
	for (const listener of listeners) listener();
}
export function useRememberedReviewPath(scope: ReviewPathStatusScope | undefined) {
	const record = useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => (scope ? records.get(key(scope)) : undefined)
	);
	return record && Date.now() - record.observedAt < 30_000 ? record.snapshot : undefined;
}
