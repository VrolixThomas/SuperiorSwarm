import type { HermesRuntimeEvent } from "../../shared/hermes";

export const HERMES_HISTORY_REVISION_ACTIVE_INTERVAL_MS = 2_000;
export const HERMES_HISTORY_REVISION_IDLE_INTERVAL_MS = 5_000;
export const HERMES_HISTORY_ACTIVITY_RECENT_WINDOW_MS = 15_000;
export const HERMES_HISTORY_ACTIVITY_REFRESH_MIN_INTERVAL_MS = 2_000;
export const HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

export interface HermesHistoryRevisionPollPolicyInput {
	pollingEnabled: boolean;
	documentVisible: boolean;
	sessionRunning: boolean;
	sessionBusy: boolean;
	lastActivityAt: number | null;
	now: number;
	consecutiveFailures: number;
}

export function hermesHistoryRevisionPollInterval(
	input: HermesHistoryRevisionPollPolicyInput
): number | false {
	if (!input.pollingEnabled || !input.documentVisible) return false;
	if (input.consecutiveFailures > 0) {
		return hermesHistoryRevisionFailureBackoff(input.consecutiveFailures);
	}
	const recentlyActive =
		input.lastActivityAt !== null &&
		input.now - input.lastActivityAt <= HERMES_HISTORY_ACTIVITY_RECENT_WINDOW_MS;
	return input.sessionRunning || input.sessionBusy || recentlyActive
		? HERMES_HISTORY_REVISION_ACTIVE_INTERVAL_MS
		: HERMES_HISTORY_REVISION_IDLE_INTERVAL_MS;
}

export function hermesHistoryRevisionFailureBackoff(consecutiveFailures: number): number {
	const backoffIndex = Math.min(
		Math.max(0, consecutiveFailures - 1),
		HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS.length - 1
	);
	return (
		HERMES_HISTORY_REVISION_FAILURE_BACKOFF_MS[backoffIndex] ??
		HERMES_HISTORY_REVISION_IDLE_INTERVAL_MS
	);
}

interface HermesHistoryRevisionQueryState {
	dataUpdatedAt: number;
	error: unknown;
	errorUpdatedAt: number;
	fetchStatus: string;
}

export function resolveHermesHistoryRevisionRefreshState(input: {
	queryState: HermesHistoryRevisionQueryState | undefined;
	recordedErrorUpdatedAt: number | null;
	recordedFailureCount: number;
	recordedFailureRetryAt: number | null;
	recordedSuccessUpdatedAt: number;
}): { failureRetryAt: number | null; queryFetching: boolean } {
	if (!input.queryState) {
		return {
			failureRetryAt: input.recordedFailureRetryAt,
			queryFetching: false,
		};
	}
	const hasUnrecordedSuccess = input.queryState.dataUpdatedAt > input.recordedSuccessUpdatedAt;
	const recordedErrorUpdatedAt = hasUnrecordedSuccess ? null : input.recordedErrorUpdatedAt;
	const recordedFailureCount = hasUnrecordedSuccess ? 0 : input.recordedFailureCount;
	const recordedFailureRetryAt = hasUnrecordedSuccess ? null : input.recordedFailureRetryAt;
	const hasUnrecordedFailure =
		input.queryState.error !== null &&
		input.queryState.errorUpdatedAt > 0 &&
		input.queryState.errorUpdatedAt !== recordedErrorUpdatedAt;
	const failures = Math.max(1, recordedFailureCount + (hasUnrecordedFailure ? 1 : 0));
	return {
		failureRetryAt:
			input.queryState.error !== null && (hasUnrecordedFailure || recordedFailureRetryAt === null)
				? input.queryState.errorUpdatedAt + hermesHistoryRevisionFailureBackoff(failures)
				: recordedFailureRetryAt,
		queryFetching: input.queryState.fetchStatus === "fetching",
	};
}

export function shouldRefreshHermesHistoryRevisionOnVisibilityChange(input: {
	wasVisible: boolean;
	isVisible: boolean;
	pollingEnabled: boolean;
}): boolean {
	return !input.wasVisible && input.isVisible && input.pollingEnabled;
}

export function isHermesHistoryRevisionActivity(
	event: Pick<HermesRuntimeEvent, "profileId" | "durableSessionId">,
	profileId: string,
	durableSessionId: string
): boolean {
	return event.profileId === profileId && event.durableSessionId === durableSessionId;
}

export function hermesHistoryRevisionIdentityKey(
	managerId: string | null,
	connectionId: string,
	profileId: string,
	durableSessionId: string
): string {
	return JSON.stringify([managerId, connectionId, profileId, durableSessionId]);
}

export function hermesSessionResumeAttemptKey(input: {
	selectionKey: string;
	connected: boolean;
	lastConnectedAt: number | null;
}): string | null {
	if (!input.connected || input.lastConnectedAt === null) return null;
	return JSON.stringify([input.selectionKey, input.lastConnectedAt]);
}

export type HermesHistoryRevisionRefreshReason = "activity" | "trailing" | "visibility";

export interface HermesHistoryRevisionRefreshTicket {
	selectionKey: string;
	generation: number;
	requestId: number;
	mode: "join" | "start";
	reason: HermesHistoryRevisionRefreshReason;
}

interface HermesHistoryRevisionRefreshInput {
	selectionKey: string;
	reason: HermesHistoryRevisionRefreshReason;
	now: number;
	failureRetryAt: number | null;
	pollingEnabled: boolean;
	documentVisible: boolean;
	queryFetching: boolean;
}

export class HermesHistoryRevisionRefreshGate {
	private selectionKey: string | null = null;
	private generation = 0;
	private requestSequence = 0;
	private inFlight: HermesHistoryRevisionRefreshTicket | null = null;
	private lastRefreshAt: number | null = null;
	private pendingRefresh = false;

	select(selectionKey: string): number {
		if (this.selectionKey === selectionKey) return this.generation;
		this.selectionKey = selectionKey;
		this.generation++;
		this.inFlight = null;
		this.lastRefreshAt = null;
		this.pendingRefresh = false;
		return this.generation;
	}

	begin(input: HermesHistoryRevisionRefreshInput): HermesHistoryRevisionRefreshTicket | null {
		if (this.selectionKey === null) this.select(input.selectionKey);
		else if (this.selectionKey !== input.selectionKey) return null;
		if (!input.pollingEnabled || !input.documentVisible) {
			return null;
		}
		if (
			input.reason === "activity" &&
			input.failureRetryAt !== null &&
			input.now < input.failureRetryAt
		) {
			return null;
		}
		if (this.inFlight) {
			if (input.reason !== "trailing" && this.inFlight.reason !== "trailing") {
				this.pendingRefresh = true;
			}
			return null;
		}
		if (input.queryFetching && input.reason === "trailing") return null;
		if (
			input.reason === "activity" &&
			this.lastRefreshAt !== null &&
			input.now - this.lastRefreshAt < HERMES_HISTORY_ACTIVITY_REFRESH_MIN_INTERVAL_MS
		) {
			return null;
		}
		const ticket = {
			selectionKey: input.selectionKey,
			generation: this.generation,
			requestId: ++this.requestSequence,
			mode: input.queryFetching ? ("join" as const) : ("start" as const),
			reason: input.reason,
		};
		this.inFlight = ticket;
		if (input.queryFetching) this.pendingRefresh = input.reason !== "trailing";
		else this.lastRefreshAt = input.now;
		return ticket;
	}

	finish(ticket: HermesHistoryRevisionRefreshTicket, successful: boolean): "trailing" | null {
		if (this.inFlight?.requestId !== ticket.requestId) return null;
		this.inFlight = null;
		const shouldRefreshTrailing =
			successful && this.pendingRefresh && ticket.reason !== "trailing" && this.isCurrent(ticket);
		this.pendingRefresh = false;
		return shouldRefreshTrailing ? "trailing" : null;
	}

	isCurrent(ticket: HermesHistoryRevisionRefreshTicket): boolean {
		return this.selectionKey === ticket.selectionKey && this.generation === ticket.generation;
	}
}
