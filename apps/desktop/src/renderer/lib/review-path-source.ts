/**
 * Stable renderer boundary for the future persisted path transport. Live PRs have no
 * path producer yet. Only callers explicitly opting into fixture mode receive samples.
 * Components consume ReviewPathSource; backend work replaces this registry and timers.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { GitHubPRDetails, PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import type { ContextFileStep, ReviewPath, ReviewPathStatus } from "../../shared/review-path-types";
import { PR129_MAPPING_FRAMES, PR129_PATH } from "./review-path-fixtures";
import { isStale } from "./review-path-model";

export const PATH_UNAVAILABLE_REASON = "Reading-path agent is not connected yet.";
const registry = new Map<string, ReviewPath>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
export function reviewPathRegistryKey(pr: PRContext, fixture = false) {
	return `${fixture ? "fixture" : "live"}:${pr.provider}:${formatPrIdentifier(pr)}`;
}
function emit() {
	for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
export function getReviewPath(pr: PRContext, fixture = false): ReviewPath | null {
	return registry.get(reviewPathRegistryKey(pr, fixture)) ?? (fixture ? PR129_PATH : null);
}
export function applyMappingFrame(state: ReviewPath | null, frame: ReviewPath): ReviewPath {
	if (!state || state.id !== frame.id) return frame;
	const entryIds = new Set(state.entries.map((entry) => entry.id));
	const placed = new Set(state.entries.flatMap((entry) => entry.steps.map((step) => step.path)));
	return {
		...frame,
		entries: [
			...state.entries.map((entry) => {
				const incoming = frame.entries.find((candidate) => candidate.id === entry.id);
				return {
					...entry,
					...incoming,
					steps: [
						...entry.steps.map(
							(step) =>
								incoming?.steps.find(
									(candidate) => candidate.id === step.id && candidate.path === step.path
								) ?? step
						),
						...(incoming?.steps.filter((step) => !placed.has(step.path)) ?? []),
					],
				};
			}),
			...frame.entries
				.filter((entry) => !entryIds.has(entry.id))
				.map((entry) => ({
					...entry,
					steps: entry.steps.filter((step) => !placed.has(step.path)),
				})),
		],
	};
}
export function addContextStep(
	path: ReviewPath,
	entryId: string,
	afterStepId: string,
	filePath: string
): ReviewPath {
	if (
		!filePath ||
		filePath.startsWith("/") ||
		filePath.split("/").includes("..") ||
		path.entries.some((entry) => entry.steps.some((step) => step.path === filePath))
	)
		return path;
	const step: ContextFileStep = {
		id: `user-context:${filePath}`,
		kind: "context",
		path: filePath,
		note: "Added by you",
		focus: [],
		addedBy: "user",
	};
	return {
		...path,
		entries: path.entries.map((entry) => {
			if (entry.id !== entryId) return entry;
			const index = entry.steps.findIndex((step) => step.id === afterStepId);
			if (index < 0) return entry;
			return {
				...entry,
				steps: [...entry.steps.slice(0, index + 1), step, ...entry.steps.slice(index + 1)],
			};
		}),
	};
}
export function removeContextStep(path: ReviewPath, stepId: string): ReviewPath {
	return {
		...path,
		entries: path.entries.map((entry) => ({
			...entry,
			steps: entry.steps.filter((step) => step.id !== stepId || step.kind !== "context"),
		})),
	};
}
export interface ReviewPathSource {
	path: ReviewPath | null;
	status: ReviewPathStatus;
	available: boolean;
	unavailableReason: string | undefined;
	start: (options: { agentId: string; alsoReview: boolean }) => void;
	stop: () => void;
	retry: () => void;
	addContextStep: (entryId: string, afterStepId: string, path: string) => void;
	removeContextStep: (stepId: string) => void;
}
export function useReviewPath(
	prCtx: PRContext,
	details: Pick<GitHubPRDetails, "headCommitOid"> | undefined,
	options: { fixture?: boolean } = {}
): ReviewPathSource {
	const fixture = options.fixture === true;
	const key = reviewPathRegistryKey(prCtx, fixture);
	const prKey = formatPrIdentifier(prCtx);
	const snapshot = useCallback(
		() => registry.get(key) ?? (fixture ? PR129_PATH : null),
		[key, fixture]
	);
	const stored = useSyncExternalStore(subscribe, snapshot, snapshot);
	const path = useMemo(
		() =>
			stored &&
			stored.status === "ready" &&
			details?.headCommitOid &&
			!fixture &&
			isStale(stored, details.headCommitOid)
				? { ...stored, status: "stale" as const }
				: stored,
		[stored, details?.headCommitOid, fixture]
	);
	const stop = useCallback(() => {
		const timer = timers.get(key);
		if (timer) clearInterval(timer);
		timers.delete(key);
		const current = registry.get(key);
		if (current?.status === "mapping") {
			registry.set(key, {
				...current,
				status: current.entries.some((entry) => entry.steps.length > 0) ? "ready" : "failed",
				progress: undefined,
			});
			emit();
		}
	}, [key]);
	const start = useCallback(
		(settings: { agentId: string; alsoReview: boolean }) => {
			stop();
			if (!fixture) {
				registry.set(key, {
					id: key,
					prKey,
					headSha: details?.headCommitOid ?? "",
					agent: { id: settings.agentId, label: settings.agentId },
					status: "failed",
					entries: [],
					otherFiles: [],
					error: PATH_UNAVAILABLE_REASON,
					updatedAt: new Date().toISOString(),
				});
				emit();
				return;
			}
			let index = 0;
			const first = PR129_MAPPING_FRAMES[0];
			if (!first) return;
			registry.set(key, { ...first, reviewed: undefined });
			emit();
			timers.set(
				key,
				setInterval(() => {
					const frame = PR129_MAPPING_FRAMES[++index];
					if (!frame) {
						stop();
						return;
					}
					const next = applyMappingFrame(registry.get(key) ?? null, frame);
					registry.set(key, settings.alsoReview ? next : { ...next, reviewed: undefined });
					emit();
					if (frame.status === "ready") {
						const timer = timers.get(key);
						if (timer) clearInterval(timer);
						timers.delete(key);
					}
				}, 650)
			);
		},
		[key, prKey, fixture, stop, details?.headCommitOid]
	);
	const change = useCallback(
		(update: (path: ReviewPath) => ReviewPath) => {
			const current = registry.get(key) ?? (fixture ? PR129_PATH : null);
			if (current) {
				registry.set(key, update(current));
				emit();
			}
		},
		[key, fixture]
	);
	return {
		path,
		status: path?.status ?? "none",
		available: fixture,
		unavailableReason: fixture ? undefined : PATH_UNAVAILABLE_REASON,
		start,
		stop,
		retry: () => start({ agentId: path?.agent.id ?? "claude", alsoReview: true }),
		addContextStep: (entry, after, file) =>
			change((path) => addContextStep(path, entry, after, file)),
		removeContextStep: (step) => change((path) => removeContextStep(path, step)),
	};
}
