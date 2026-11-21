import { useSyncExternalStore } from "react";
import type { ReviewPathIdentity } from "../../shared/review-path-runtime";

const bindings = new Map<string, { draftId: string; mappingRunId?: string }>();
const listeners = new Set<() => void>();
const mappingRuns = new Map<string, string | undefined>();
const key = (i: ReviewPathIdentity) =>
	JSON.stringify([i.workspaceId, i.provider, i.owner, i.repo, i.prNumber, i.headSha]);
export function observeReviewMapping(identity: ReviewPathIdentity, runId: string | undefined) {
	const scope = key(identity);
	const previous = mappingRuns.get(scope);
	mappingRuns.set(scope, runId);
	if (previous !== runId && bindings.has(scope)) {
		bindings.delete(scope);
		for (const listener of listeners) listener();
	}
}
export function setReviewDraftBinding(
	identity: ReviewPathIdentity,
	draftId: string,
	mappingRunId?: string
) {
	bindings.set(key(identity), {
		draftId,
		mappingRunId: mappingRunId ?? mappingRuns.get(key(identity)),
	});
	for (const listener of listeners) listener();
}
export function useReviewDraftBinding(identity: ReviewPathIdentity | undefined) {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => (identity ? bindings.get(key(identity)) : undefined)
	);
}
