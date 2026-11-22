/**
 * Durable live transport with exact workspace/revision scope.
 * The illustrative registry and timers are accessible only through explicit fixture opt-in.
 */
import { replaceEqualDeep } from "@tanstack/react-query";
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
import { observeReviewMapping } from "./review-draft-binding";
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
	/** A start request is preparing the agent; no terminal is implied yet. */
	starting?: boolean;
	agentSessionStarted?: boolean;
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
	pollError?: string;
	pending: boolean;
	starting?: boolean;
	mutationErrors?: Partial<Record<string, { id?: string; message: string }>>;
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
/** Snapshot ordering is separate from delivery of each acknowledged mutation. */
export function createLiveReviewPathController(
	identity: ReviewPathIdentity,
	transport: ReviewPathTransport,
	options: { schedulePoll?: (callback: () => void, delayMs: number) => () => void } = {}
) {
	let state: LiveReviewPathState = { snapshot: null, available: false, pending: false };
	let sequence = 0;
	let pendingMutations = 0;
	let pendingStarts = 0;
	const mutationSequences = new Map<string, number>();
	const subscribers = new Set<() => void>();
	let inFlightRefresh: Promise<ReviewPathSnapshot | undefined> | undefined;
	let pollFailures = 0;
	let pollingConsumers = 0;
	let pollingGeneration = 0;
	let cancelPoll: (() => void) | undefined;
	const schedulePoll =
		options.schedulePoll ??
		((callback, delayMs) => {
			const timer = setTimeout(callback, delayMs);
			return () => clearTimeout(timer);
		});
	const publish = (next: LiveReviewPathState) => {
		const previous = state;
		state = replaceEqualDeep(previous, {
			...next,
			error:
				next.pollError ?? Object.values(next.mutationErrors ?? {}).find((error) => error)?.message,
		});
		if (state === previous) return;
		// Fence delayed comment acknowledgements before notifying renderer subscribers.
		if (state.snapshot && state.snapshot.runs !== previous.snapshot?.runs) {
			let mapping: ReviewPathRun | undefined;
			for (const run of state.snapshot.runs)
				if (
					run.kind === "mapping" &&
					reviewPathIdentityKey(run.identity) === reviewPathIdentityKey(identity) &&
					(!mapping || run.version > mapping.version)
				)
					mapping = run;
			observeReviewMapping(identity, mapping?.id);
		}
		for (const subscriber of subscribers) subscriber();
	};
	async function perform<
		T extends
			| ReviewPathSnapshot
			| { snapshot: ReviewPathSnapshot; launch?: ReviewPathLaunchResult },
	>(operation: () => Promise<T>, mutation?: string, id?: string): Promise<T | undefined> {
		const generation = ++sequence;
		if (mutation) {
			pendingMutations++;
			if (mutation === "start") pendingStarts++;
			mutationSequences.set(mutation, generation);
			publish({
				...state,
				pending: true,
				starting: pendingStarts > 0,
				mutationErrors: { ...state.mutationErrors, [mutation]: undefined },
			});
		}
		try {
			const result = await operation();
			const incoming: ReviewPathSnapshot =
				"snapshot" in result ? result.snapshot : (result as ReviewPathSnapshot);
			if (reviewPathIdentityKey(incoming.identity) !== reviewPathIdentityKey(identity))
				throw new Error(
					"Reading-path response identity mismatch. Refresh the PR to use its current head."
				);
			if (generation === sequence) {
				pollFailures = 0;
				publish({ ...state, snapshot: incoming, available: true, pollError: undefined });
			}
			// A later operation can supersede this snapshot, but not its owned launch result.
			return mutation || generation === sequence ? result : undefined;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (mutation) {
				if (mutationSequences.get(mutation) === generation)
					publish({
						...state,
						mutationErrors: { ...state.mutationErrors, [mutation]: { id, message } },
					});
			} else if (generation === sequence) {
				pollFailures++;
				publish({ ...state, available: false, pollError: message });
			}
			return undefined;
		} finally {
			if (mutation) {
				pendingMutations--;
				if (mutation === "start") pendingStarts--;
				publish({ ...state, pending: pendingMutations > 0, starting: pendingStarts > 0 });
			}
		}
	}
	const scope = (run: ReviewPathRun): ReviewPathRunScope => ({
		identity: run.identity,
		id: run.id,
		version: run.version,
	});
	const refresh = (): Promise<ReviewPathSnapshot | undefined> => {
		if (state.pending) return Promise.resolve(undefined);
		if (inFlightRefresh) return inFlightRefresh;
		const request = perform(() => transport.get({ identity }));
		inFlightRefresh = request;
		void request.finally(() => {
			if (inFlightRefresh === request) inFlightRefresh = undefined;
		});
		return request;
	};
	const poll = async (generation: number) => {
		await refresh();
		if (!pollingConsumers || generation !== pollingGeneration) return;
		// Slow and unavailable backends get one bounded retry loop, not overlapping reads.
		const delay = Math.min(30_000, 1500 * 2 ** Math.min(pollFailures, 5));
		cancelPoll = schedulePoll(() => {
			cancelPoll = undefined;
			void poll(generation);
		}, delay);
	};
	return {
		getSnapshot: () => state,
		subscribe: (callback: () => void) => {
			subscribers.add(callback);
			return () => {
				subscribers.delete(callback);
			};
		},
		refresh,
		retainPolling: () => {
			pollingConsumers++;
			if (pollingConsumers === 1) void poll(++pollingGeneration);
			let retained = true;
			return () => {
				if (!retained) return;
				retained = false;
				if (--pollingConsumers === 0) {
					pollingGeneration++;
					cancelPoll?.();
					cancelPoll = undefined;
				}
			};
		},
		start: (agent: ReviewPath["agent"], alsoReview: boolean) =>
			perform(() => transport.start({ identity, agent, alsoReview }), "start"),
		stop: () => {
			const run = state.snapshot?.runs.find(
				(run) => run.kind === "mapping" && run.state === "running"
			);
			return run
				? perform(() => transport.cancel(scope(run)), "cancel")
				: Promise.resolve(undefined);
		},
		ask: (id: string, text: string, anchor?: AskMessage["anchor"]) =>
			perform(() => transport.ask({ identity, id, text, anchor }), "ask", id),
		cancelQuestion: (id: string) => {
			const run = state.snapshot?.runs.find(
				(run) => run.questionId === id && run.state === "running"
			);
			return run
				? perform(() => transport.cancelQuestion(scope(run)), "cancelQuestion", id)
				: Promise.resolve(undefined);
		},
		addContext: (entryId: string, step: ContextFileStep) =>
			perform(() => transport.addContext({ identity, entryId, step }), "addContext"),
		removeContext: (stepId: string) =>
			perform(() => transport.removeContext({ identity, stepId }), "removeContext"),
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
export function useLiveReviewPath(
	identity: ReviewPathIdentity | undefined,
	options: { observeOnly?: boolean } = {}
) {
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
		if (!controller || options.observeOnly) return;
		return controller.retainPolling();
	}, [controller, options.observeOnly]);
	const lifecycle = useRef({ controller, mounted: true });
	lifecycle.current.controller = controller;
	useEffect(() => {
		lifecycle.current.mounted = true;
		return () => {
			lifecycle.current.mounted = false;
		};
	}, []);
	const isCurrent = useCallback(
		() => lifecycle.current.mounted && lifecycle.current.controller === controller,
		[controller]
	);
	return { state, controller, isCurrent };
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
	const { state, controller, isCurrent } = useLiveReviewPath(
		options.fixture ? undefined : identity
	);
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
					if (result?.launch && isCurrent()) options.onLaunch?.(result.launch);
				});
		},
		[controller, options.onLaunch, isCurrent]
	);
	if (options.fixture) return fixture;
	const path = state.snapshot?.path ?? null;
	const latestMapping = state.snapshot?.runs
		.filter((run) => run.kind === "mapping")
		.sort((a, b) => b.version - a.version)[0];
	return {
		starting: !!state.starting,
		agentSessionStarted: !!latestMapping?.terminalId,
		path,
		status: path?.status ?? "none",
		available: state.available && !state.pending,
		unavailableReason:
			Object.entries(state.mutationErrors ?? {}).find(
				([operation, error]) => operation !== "ask" && operation !== "cancelQuestion" && error
			)?.[1]?.message ?? (controller ? state.pollError : state.error),
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
