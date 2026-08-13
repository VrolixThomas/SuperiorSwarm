import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	HERMES_CATALOG_SYNC_INTERVAL_MS,
	HERMES_HISTORY_ACTIVITY_RECENT_WINDOW_MS,
	HERMES_HISTORY_ACTIVITY_REFRESH_MIN_INTERVAL_MS,
	HERMES_HISTORY_REVISION_ACTIVE_INTERVAL_MS,
	HERMES_HISTORY_REVISION_EXTERNAL_INTERVAL_MS,
	HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS,
	HERMES_HISTORY_REVISION_IDLE_INTERVAL_MS,
	HermesHistoryRevisionRefreshGate,
	hermesEventRefreshesCatalog,
	hermesHistoryRevisionIdentityKey,
	hermesHistoryRevisionPollInterval,
	hermesSessionResumeAttemptKey,
	isHermesHistoryRevisionActivity,
	resolveHermesHistoryRevisionRefreshState,
	shouldRefreshHermesHistoryRevisionOnVisibilityChange,
} from "../src/renderer/hermes/hermes-history-polling";
import { HermesHistorySyncCoordinator } from "../src/renderer/hermes/hermes-view-model";
import type { HermesRuntimeEvent } from "../src/shared/hermes";

const activity = (overrides: Partial<HermesRuntimeEvent> = {}): HermesRuntimeEvent => ({
	type: "message.delta",
	profileId: "work",
	runtimeSessionId: "runtime-1",
	durableSessionId: "session-1",
	turnId: "turn-1",
	requestId: null,
	text: "Working",
	toolName: null,
	status: "streaming",
	payload: {},
	workspaceArtifacts: [],
	receivedAt: 1_000,
	...overrides,
});

const pollInterval = (
	overrides: Partial<Parameters<typeof hermesHistoryRevisionPollInterval>[0]> = {}
) =>
	hermesHistoryRevisionPollInterval({
		pollingEnabled: true,
		documentVisible: true,
		sessionRunning: false,
		sessionBusy: false,
		lastActivityAt: null,
		now: 20_000,
		consecutiveFailures: 0,
		...overrides,
	});

test("refreshes the sidebar on lifecycle boundaries without refetching for every token", () => {
	expect(hermesEventRefreshesCatalog(activity({ type: "message.delta" }))).toBe(false);
	expect(hermesEventRefreshesCatalog(activity({ type: "tool.start" }))).toBe(false);
	expect(hermesEventRefreshesCatalog(activity({ type: "message.complete" }))).toBe(true);
	expect(hermesEventRefreshesCatalog(activity({ type: "turn.failed" }))).toBe(true);
	expect(hermesEventRefreshesCatalog(activity({ type: "runtime.history-refresh-required" }))).toBe(
		true
	);
});

describe("Hermes history revision polling", () => {
	test("uses the active cadence while running, busy, or recently active and idles at five seconds", () => {
		expect(HERMES_HISTORY_REVISION_ACTIVE_INTERVAL_MS).toBe(2_000);
		expect(HERMES_HISTORY_REVISION_IDLE_INTERVAL_MS).toBe(5_000);
		expect(pollInterval({ sessionRunning: true })).toBe(2_000);
		expect(pollInterval({ sessionBusy: true })).toBe(2_000);
		expect(
			pollInterval({
				lastActivityAt: 20_000 - HERMES_HISTORY_ACTIVITY_RECENT_WINDOW_MS,
			})
		).toBe(2_000);
		expect(
			pollInterval({
				lastActivityAt: 20_000 - HERMES_HISTORY_ACTIVITY_RECENT_WINDOW_MS - 1,
			})
		).toBe(5_000);
	});

	test("tracks a selected Slack or Telegram handoff within half a second", () => {
		expect(HERMES_CATALOG_SYNC_INTERVAL_MS).toBe(1_000);
		expect(HERMES_HISTORY_REVISION_EXTERNAL_INTERVAL_MS).toBe(500);
		expect(pollInterval({ externalSource: true })).toBe(500);
		expect(pollInterval({ externalSource: true, sessionRunning: true })).toBe(500);
		expect(pollInterval({ externalSource: true, consecutiveFailures: 1 })).toBe(5_000);
	});

	test("pauses explicitly when the exact selected session is not pollable or the document is hidden", () => {
		expect(pollInterval({ pollingEnabled: false })).toBe(false);
		expect(pollInterval({ documentVisible: false, sessionRunning: true })).toBe(false);
		expect(
			shouldRefreshHermesHistoryRevisionOnVisibilityChange({
				wasVisible: true,
				isVisible: false,
				pollingEnabled: true,
			})
		).toBe(false);
		expect(
			shouldRefreshHermesHistoryRevisionOnVisibilityChange({
				wasVisible: false,
				isVisible: true,
				pollingEnabled: true,
			})
		).toBe(true);
		expect(
			shouldRefreshHermesHistoryRevisionOnVisibilityChange({
				wasVisible: false,
				isVisible: true,
				pollingEnabled: false,
			})
		).toBe(false);
	});

	test("backs off consecutive failures to five, fifteen, thirty, then sixty seconds", () => {
		expect(HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS).toEqual([5_000, 15_000, 30_000, 60_000]);
		expect(pollInterval({ sessionRunning: true, consecutiveFailures: 1 })).toBe(5_000);
		expect(pollInterval({ sessionRunning: true, consecutiveFailures: 2 })).toBe(15_000);
		expect(pollInterval({ sessionRunning: true, consecutiveFailures: 3 })).toBe(30_000);
		expect(pollInterval({ sessionRunning: true, consecutiveFailures: 4 })).toBe(60_000);
		expect(pollInterval({ sessionRunning: true, consecutiveFailures: 40 })).toBe(60_000);
	});

	test("resets failure backoff only on revision success or full selection identity change", () => {
		const sync = new HermesHistorySyncCoordinator();
		const selected = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"work",
			"session-1"
		);
		const otherManager = hermesHistoryRevisionIdentityKey(
			"manager-2",
			"connection-1",
			"work",
			"session-1"
		);

		sync.recordRevisionFailure(selected, 101, 1_000);
		sync.recordRevisionFailure(selected, 102, 2_000);
		expect(sync.revisionFailureCount(selected)).toBe(2);
		expect(sync.revisionFailureCount(selected)).toBe(2);

		sync.decide(selected, {
			durableSessionId: "session-1",
			latestMessageId: "message-1",
			latestMessageAt: 3_000,
			latestMessageIdIsStable: true,
		});
		expect(sync.revisionFailureCount(selected)).toBe(0);

		sync.recordRevisionFailure(selected, 103, 4_000);
		expect(sync.revisionFailureCount(selected)).toBe(1);
		expect(sync.revisionFailureCount(otherManager)).toBe(0);
	});

	test("retries resume after a manager reconnect even when disconnected status was never observed", () => {
		const managerBSelection = hermesHistoryRevisionIdentityKey(
			"manager-2",
			"connection-1",
			"work",
			"session-1"
		);
		const transientAttempt = hermesSessionResumeAttemptKey({
			selectionKey: managerBSelection,
			connected: true,
			lastConnectedAt: 1_000,
		});

		// The connection list can expose the new manager while status still contains
		// the prior runtime's connected snapshot. That first resume may reject.
		expect(
			hermesSessionResumeAttemptKey({
				selectionKey: managerBSelection,
				connected: true,
				lastConnectedAt: 1_000,
			})
		).toBe(transientAttempt);

		// Installing the new runtime changes its ready epoch, which permits exactly
		// one new resume attempt without requiring a sampled disconnected state.
		const installedAttempt = hermesSessionResumeAttemptKey({
			selectionKey: managerBSelection,
			connected: true,
			lastConnectedAt: 2_000,
		});
		expect(installedAttempt).not.toBe(transientAttempt);
		expect(
			hermesSessionResumeAttemptKey({
				selectionKey: managerBSelection,
				connected: false,
				lastConnectedAt: 2_000,
			})
		).toBeNull();
	});

	test("recognizes live activity only for the selected exact profile and durable identity", () => {
		expect(isHermesHistoryRevisionActivity(activity(), "work", "session-1")).toBe(true);
		expect(
			isHermesHistoryRevisionActivity(activity({ profileId: "personal" }), "work", "session-1")
		).toBe(false);
		expect(
			isHermesHistoryRevisionActivity(
				activity({ durableSessionId: "session-2" }),
				"work",
				"session-1"
			)
		).toBe(false);
		expect(
			isHermesHistoryRevisionActivity(activity({ durableSessionId: null }), "work", "session-1")
		).toBe(false);
	});

	test("deduplicates immediate activity refreshes and never overlaps an active revision request", () => {
		const gate = new HermesHistoryRevisionRefreshGate();
		const selectionKey = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"work",
			"session-1"
		);
		const first = gate.begin({
			selectionKey,
			reason: "activity",
			now: 1_000,
			failureRetryAt: null,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: false,
		});
		expect(first).not.toBeNull();
		expect(first?.mode).toBe("start");
		expect(
			gate.begin({
				selectionKey,
				reason: "activity",
				now: 1_001,
				failureRetryAt: null,
				pollingEnabled: true,
				documentVisible: true,
				queryFetching: false,
			})
		).toBeNull();
		if (!first) throw new Error("Expected a refresh ticket");
		expect(gate.finish(first, true)).toBe("trailing");
		const trailing = gate.begin({
			selectionKey,
			reason: "trailing",
			now: 1_002,
			failureRetryAt: null,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: false,
		});
		expect(trailing?.mode).toBe("start");
		if (!trailing) throw new Error("Expected one trailing refresh ticket");
		expect(
			gate.begin({
				selectionKey,
				reason: "activity",
				now: 1_003,
				failureRetryAt: null,
				pollingEnabled: true,
				documentVisible: true,
				queryFetching: false,
			})
		).toBeNull();
		expect(gate.finish(trailing, true)).toBeNull();
		expect(
			gate.begin({
				selectionKey,
				reason: "activity",
				now: 1_000 + HERMES_HISTORY_ACTIVITY_REFRESH_MIN_INTERVAL_MS - 1,
				failureRetryAt: null,
				pollingEnabled: true,
				documentVisible: true,
				queryFetching: false,
			})
		).toBeNull();
		expect(
			gate.begin({
				selectionKey,
				reason: "activity",
				now: 1_000 + HERMES_HISTORY_ACTIVITY_REFRESH_MIN_INTERVAL_MS,
				failureRetryAt: null,
				pollingEnabled: true,
				documentVisible: true,
				queryFetching: true,
			})
		).toBeNull();
	});

	test("coalesces activity over a scheduled request into exactly one successful trailing refresh", () => {
		const gate = new HermesHistoryRevisionRefreshGate();
		const selectionKey = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"work",
			"session-1"
		);
		const joined = gate.begin({
			selectionKey,
			reason: "activity",
			now: 5_000,
			failureRetryAt: null,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: true,
		});
		expect(joined?.mode).toBe("join");
		if (!joined) throw new Error("Expected to join the scheduled request");
		expect(gate.finish(joined, true)).toBe("trailing");

		const failedJoin = gate.begin({
			selectionKey,
			reason: "activity",
			now: 7_000,
			failureRetryAt: null,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: true,
		});
		expect(failedJoin?.mode).toBe("join");
		if (!failedJoin) throw new Error("Expected to join the failing request");
		expect(gate.finish(failedJoin, false)).toBeNull();
	});

	test("does not let continuous activity bypass failure backoff but permits one visible resume", () => {
		const gate = new HermesHistoryRevisionRefreshGate();
		const selectionKey = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"work",
			"session-1"
		);
		const input = {
			selectionKey,
			failureRetryAt: 61_000,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: false,
		};

		expect(gate.begin({ ...input, reason: "activity", now: 2_000 })).toBeNull();
		expect(gate.begin({ ...input, reason: "activity", now: 60_999 })).toBeNull();
		const visibleResume = gate.begin({ ...input, reason: "visibility", now: 3_000 });
		expect(visibleResume?.mode).toBe("start");
		if (!visibleResume) throw new Error("Expected a visible-resume refresh");
		expect(gate.finish(visibleResume, false)).toBeNull();
		expect(gate.begin({ ...input, reason: "activity", now: 61_000 })?.mode).toBe("start");
	});

	test("coalesces a visible resume over an active scheduled request", () => {
		const gate = new HermesHistoryRevisionRefreshGate();
		const selectionKey = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"work",
			"session-1"
		);
		const joined = gate.begin({
			selectionKey,
			reason: "visibility",
			now: 5_000,
			failureRetryAt: 60_000,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: true,
		});

		expect(joined?.mode).toBe("join");
		if (!joined) throw new Error("Expected to join the scheduled request");
		expect(gate.finish(joined, true)).toBe("trailing");
	});

	test("reads request overlap and a new failure deadline from live React Query state", async () => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const queryKey = ["hermes", "historyRevision", "selected"] as const;
		let rejectRequest = (_error: Error): void => {
			throw new Error("Revision request did not start");
		};
		const request = queryClient.fetchQuery({
			queryKey,
			queryFn: () =>
				new Promise<never>((_resolve, reject) => {
					rejectRequest = reject;
				}),
		});
		await Promise.resolve();

		expect(
			resolveHermesHistoryRevisionRefreshState({
				queryState: queryClient.getQueryState(queryKey),
				recordedErrorUpdatedAt: null,
				recordedFailureCount: 0,
				recordedFailureRetryAt: null,
				recordedSuccessUpdatedAt: 0,
			})
		).toEqual({ failureRetryAt: null, queryFetching: true });

		rejectRequest(new Error("revision unavailable"));
		await expect(request).rejects.toThrow("revision unavailable");
		const failedState = queryClient.getQueryState(queryKey);
		if (!failedState) throw new Error("Expected a failed query state");
		expect(
			resolveHermesHistoryRevisionRefreshState({
				queryState: failedState,
				recordedErrorUpdatedAt: null,
				recordedFailureCount: 0,
				recordedFailureRetryAt: null,
				recordedSuccessUpdatedAt: 0,
			})
		).toEqual({
			failureRetryAt: failedState.errorUpdatedAt + HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS[0],
			queryFetching: false,
		});
		expect(
			resolveHermesHistoryRevisionRefreshState({
				queryState: failedState,
				recordedErrorUpdatedAt: failedState.errorUpdatedAt - 1,
				recordedFailureCount: 1,
				recordedFailureRetryAt: failedState.errorUpdatedAt - 1 + 5_000,
				recordedSuccessUpdatedAt: 0,
			})
		).toEqual({
			failureRetryAt: failedState.errorUpdatedAt + HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS[1],
			queryFetching: false,
		});
		queryClient.clear();
	});

	test("allows the new identity immediately while marking an older selection request stale", () => {
		const gate = new HermesHistoryRevisionRefreshGate();
		const firstSelection = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"work",
			"session-1"
		);
		const secondSelection = hermesHistoryRevisionIdentityKey(
			"manager-1",
			"connection-1",
			"personal",
			"session-1"
		);
		const first = gate.begin({
			selectionKey: firstSelection,
			reason: "activity",
			now: 1_000,
			failureRetryAt: null,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: false,
		});
		if (!first) throw new Error("Expected a refresh ticket");

		gate.select(secondSelection);
		expect(gate.isCurrent(first)).toBe(false);
		expect(
			gate.begin({
				selectionKey: firstSelection,
				reason: "activity",
				now: 1_001,
				failureRetryAt: null,
				pollingEnabled: true,
				documentVisible: true,
				queryFetching: false,
			})
		).toBeNull();
		const second = gate.begin({
			selectionKey: secondSelection,
			reason: "visibility",
			now: 1_002,
			failureRetryAt: null,
			pollingEnabled: true,
			documentVisible: true,
			queryFetching: false,
		});
		expect(second).not.toBeNull();
		if (!second) throw new Error("Expected a refresh ticket for the new selection");

		expect(gate.finish(first, true)).toBeNull();
		expect(gate.isCurrent(second)).toBe(true);
		expect(
			gate.begin({
				selectionKey: secondSelection,
				reason: "visibility",
				now: 1_003,
				failureRetryAt: null,
				pollingEnabled: true,
				documentVisible: true,
				queryFetching: false,
			})
		).toBeNull();
	});

	test("wires the renderer to explicit visibility and selected-activity refreshes", async () => {
		const source = await Bun.file(
			new URL("../src/renderer/components/hermes/HermesSessionView.tsx", import.meta.url)
		).text();

		expect(source).not.toContain("HERMES_HISTORY_REVISION_INTERVAL_MS = 1_000");
		expect(source).toContain('document.addEventListener("visibilitychange"');
		expect(source).toContain("hermesHistoryRevisionPollInterval({");
		expect(source).toContain("shouldRefreshHermesHistoryRevisionOnVisibilityChange({");
		expect(source).toContain('refreshHistoryRevisionImmediately("activity"');
		expect(source).toMatch(/historyRevision\s*\.refetch\(\{ cancelRefetch: false \}\)/);
		expect(source).toContain("isHermesHistoryRevisionActivity(event, profileId, sessionId)");
		expect(source).toContain("HERMES_HISTORY_TAIL_LIMIT");
		expect(source).toContain("const selectionKey = hermesHistoryRevisionIdentityKey(");
		expect(source).toContain("const resumeAttemptIdentity = hermesSessionResumeAttemptKey({");
		expect(source).toContain("resumeAttemptKey.current === resumeAttemptIdentity");
		expect(source).toMatch(
			/resume\.mutate\(\s*\{\s*connectionId,\s*managerId: activeConnection\.managerId,\s*profileId/
		);
		expect(source).toMatch(
			/hermes\.events\.useQuery\(\s*\{\s*connectionId,\s*managerId: activeConnection\?\.managerId \?\? null,\s*afterSeq: cursor\s*\}/
		);
		expect(source).not.toMatch(/catalog\.data\?\.sessions\.(map|forEach).*historyRevision/s);
	});
});
