/**
 * Durable live transport with exact workspace/revision scope.
 * The illustrative registry and timers are accessible only through explicit fixture opt-in.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { GitHubPRDetails, PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import type {
	ReviewPathIdentity,
	ReviewPathLaunchResult,
	ReviewPathRun,
	ReviewPathRunScope,
	ReviewPathSnapshot,
} from "../../shared/review-path-runtime";
import type {
	AskMessage,
	ContextFileStep,
	ReviewPath,
	ReviewPathStatus,
} from "../../shared/review-path-types";
import { initializeReviewPathSettings } from "../stores/review-path-settings-store";
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
function useFixtureReviewPath(
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

export interface ReviewPathTransport {
	get(input: { identity: ReviewPathIdentity }): Promise<ReviewPathSnapshot>;
	start(input: {
		identity: ReviewPathIdentity;
		agent: ReviewPath["agent"];
		alsoReview: boolean;
	}): Promise<{ snapshot: ReviewPathSnapshot; launch?: ReviewPathLaunchResult }>;
	cancel(input: ReviewPathRunScope): Promise<ReviewPathSnapshot>;
	ask(input: {
		identity: ReviewPathIdentity;
		id: string;
		text: string;
		anchor?: AskMessage["anchor"];
	}): Promise<{ snapshot: ReviewPathSnapshot; launch?: ReviewPathLaunchResult }>;
	cancelQuestion(input: ReviewPathRunScope): Promise<ReviewPathSnapshot>;
	addContext(input: {
		identity: ReviewPathIdentity;
		entryId: string;
		step: ContextFileStep;
	}): Promise<ReviewPathSnapshot>;
	removeContext(input: {
		identity: ReviewPathIdentity;
		stepId: string;
	}): Promise<ReviewPathSnapshot>;
}
export interface LiveReviewPathState {
	snapshot: ReviewPathSnapshot | null;
	available: boolean;
	error?: string;
	pending: boolean;
}
export function reviewPathIdentityKey(identity: ReviewPathIdentity): string {
	return JSON.stringify([
		identity.workspaceId,
		identity.provider,
		identity.owner,
		identity.repo,
		identity.prNumber,
		identity.headSha,
	]);
}
/** Polls and mutations share a sequence fence; late reads cannot overwrite a newer action. */
export function createLiveReviewPathController(
	identity: ReviewPathIdentity,
	transport: ReviewPathTransport
) {
	let state: LiveReviewPathState = { snapshot: null, available: false, pending: false };
	let sequence = 0;
	const subscribers = new Set<() => void>();
	const publish = (next: LiveReviewPathState) => {
		state = next;
		for (const subscriber of subscribers) subscriber();
	};
	async function perform<
		T extends
			| ReviewPathSnapshot
			| { snapshot: ReviewPathSnapshot; launch?: ReviewPathLaunchResult },
	>(operation: () => Promise<T>, mutation = false): Promise<T | undefined> {
		const generation = ++sequence;
		if (mutation) publish({ ...state, pending: true, error: undefined });
		try {
			const result = await operation();
			const incoming: ReviewPathSnapshot =
				"snapshot" in result ? result.snapshot : (result as ReviewPathSnapshot);
			if (reviewPathIdentityKey(incoming.identity) !== reviewPathIdentityKey(identity))
				throw new Error("Reading-path response identity mismatch");
			if (generation !== sequence) return undefined;
			publish({ snapshot: incoming, available: true, pending: false });
			return result;
		} catch (error) {
			if (generation === sequence)
				publish({
					...state,
					available: false,
					pending: false,
					error: error instanceof Error ? error.message : String(error),
				});
			return undefined;
		}
	}
	const scope = (run: ReviewPathRun): ReviewPathRunScope => ({
		identity: run.identity,
		id: run.id,
		version: run.version,
	});
	return {
		getSnapshot: () => state,
		subscribe: (callback: () => void) => {
			subscribers.add(callback);
			return () => {
				subscribers.delete(callback);
			};
		},
		refresh: () =>
			state.pending ? Promise.resolve(undefined) : perform(() => transport.get({ identity })),
		start: (agent: ReviewPath["agent"], alsoReview: boolean) =>
			perform(() => transport.start({ identity, agent, alsoReview }), true),
		stop: () => {
			const run = state.snapshot?.runs.find(
				(run) => run.kind === "mapping" && run.state === "running"
			);
			return run ? perform(() => transport.cancel(scope(run)), true) : Promise.resolve(undefined);
		},
		ask: (id: string, text: string, anchor?: AskMessage["anchor"]) =>
			perform(() => transport.ask({ identity, id, text, anchor }), true),
		cancelQuestion: (id: string) => {
			const run = state.snapshot?.runs.find(
				(run) => run.questionId === id && run.state === "running"
			);
			return run
				? perform(() => transport.cancelQuestion(scope(run)), true)
				: Promise.resolve(undefined);
		},
		addContext: (entryId: string, step: ContextFileStep) =>
			perform(() => transport.addContext({ identity, entryId, step }), true),
		removeContext: (stepId: string) =>
			perform(() => transport.removeContext({ identity, stepId }), true),
	};
}

// Lazy import keeps pure fixtures/tests independent from Electron IPC initialization.
const liveTransport: ReviewPathTransport = {
	get: async (input) => (await import("../trpc/client")).trpcVanilla.reviewPath.get.query(input),
	start: async (input) =>
		(await import("../trpc/client")).trpcVanilla.reviewPath.start.mutate(input),
	cancel: async (input) =>
		(await import("../trpc/client")).trpcVanilla.reviewPath.cancel.mutate(input),
	ask: async (input) => (await import("../trpc/client")).trpcVanilla.reviewPath.ask.mutate(input),
	cancelQuestion: async (input) =>
		(await import("../trpc/client")).trpcVanilla.reviewPath.cancelQuestion.mutate(input),
	addContext: async (input) =>
		(await import("../trpc/client")).trpcVanilla.reviewPath.addContext.mutate(input),
	removeContext: async (input) =>
		(await import("../trpc/client")).trpcVanilla.reviewPath.removeContext.mutate(input),
};
const liveControllers = new Map<string, ReturnType<typeof createLiveReviewPathController>>();
const noIdentityState: LiveReviewPathState = {
	snapshot: null,
	available: false,
	pending: false,
	error: `${PATH_UNAVAILABLE_REASON} A linked review workspace and exact PR head are required.`,
};
const noSubscribe = () => () => {};
const noSnapshot = () => noIdentityState;
export function useLiveReviewPath(identity: ReviewPathIdentity | undefined) {
	const key = identity ? reviewPathIdentityKey(identity) : undefined;
	const controller = useMemo(() => {
		if (!key || !identity) return undefined;
		let current = liveControllers.get(key);
		if (!current) {
			current = createLiveReviewPathController(identity, liveTransport);
			liveControllers.set(key, current);
		}
		return current;
	}, [key, identity]);
	const state = useSyncExternalStore(
		controller?.subscribe ?? noSubscribe,
		controller?.getSnapshot ?? noSnapshot,
		controller?.getSnapshot ?? noSnapshot
	);
	useEffect(() => {
		if (!controller) return;
		void controller.refresh();
		const timer = setInterval(() => {
			void controller.refresh();
		}, 1500);
		return () => clearInterval(timer);
	}, [controller]);
	return { state, controller };
}
export interface ReviewPathSourceOptions {
	fixture?: boolean;
	workspaceId?: string;
	identity?: ReviewPathIdentity;
	onLaunch?: (launch: ReviewPathLaunchResult) => void;
}
export function useReviewPath(
	prCtx: PRContext,
	details: Pick<GitHubPRDetails, "headCommitOid"> | undefined,
	options: ReviewPathSourceOptions = {}
): ReviewPathSource {
	useEffect(() => {
		if (!options.fixture) void initializeReviewPathSettings();
	}, [options.fixture]);
	const fixture = useFixtureReviewPath(prCtx, details, { fixture: options.fixture });
	const identity =
		options.identity ??
		(options.workspaceId && details?.headCommitOid
			? {
					workspaceId: options.workspaceId,
					provider: prCtx.provider,
					owner: prCtx.owner,
					repo: prCtx.repo,
					prNumber: prCtx.number,
					headSha: details.headCommitOid,
				}
			: undefined);
	const { state, controller } = useLiveReviewPath(options.fixture ? undefined : identity);
	const lastOptions = useRef<{ agentId: string; alsoReview: boolean } | undefined>(undefined);
	const start = useCallback(
		(settings: { agentId: string; alsoReview: boolean }) => {
			lastOptions.current = settings;
			void controller
				?.start(
					{ id: settings.agentId, label: settings.agentId === "codex" ? "Codex" : "Claude Code" },
					settings.alsoReview
				)
				.then((result) => {
					if (result?.launch) options.onLaunch?.(result.launch);
				});
		},
		[controller, options.onLaunch]
	);
	if (options.fixture) return fixture;
	const path = state.snapshot?.path ?? null;
	return {
		path,
		status: path?.status ?? "none",
		available: state.available && !state.pending,
		unavailableReason: state.error,
		start,
		stop: () => {
			void controller?.stop();
		},
		retry: () =>
			start(lastOptions.current ?? { agentId: path?.agent.id ?? "codex", alsoReview: false }),
		addContextStep: (entry, after, file) => {
			if (!path) return;
			const next = addContextStep(path, entry, after, file);
			const step = next.entries
				.find((candidate) => candidate.id === entry)
				?.steps.find((candidate) => candidate.path === file && candidate.kind === "context");
			if (step?.kind === "context") void controller?.addContext(entry, step);
		},
		removeContextStep: (step) => {
			void controller?.removeContext(step);
		},
	};
}
