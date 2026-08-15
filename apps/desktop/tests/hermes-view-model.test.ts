import { describe, expect, test } from "bun:test";
import {
	HERMES_CHAT_OVERFLOW_CLASSES,
	HERMES_HISTORY_CANONICAL_FALLBACK_INTERVAL_MS,
	HermesHistorySyncCoordinator,
	applyHermesEvent,
	applyHermesHistoryTail,
	canMergeHermesHistoryTail,
	classifyHermesTranscriptMessage,
	createHermesLiveState,
	createHermesOptimisticUserTurn,
	decideHermesHistorySync,
	deriveHermesCanonicalTimeline,
	filterHermesSessions,
	groupHermesSessions,
	hermesActivitySummary,
	hermesComposerContainsFiles,
	hermesComposerEnterAction,
	hermesComposerInteractionPolicy,
	hermesComposerTransferAction,
	hermesConnectionFormPolicy,
	hermesOriginActionAvailability,
	hermesOriginReturnLabel,
	hermesRendererAttachmentSelectionError,
	hermesReportRequiresExplicitRetry,
	hermesSessionVirtualRange,
	latestReportableHermesMessage,
	mergeHermesHistoryTail,
	projectHermesActiveTurn,
	projectHermesLiveActivity,
	projectHermesLiveCompletions,
	projectHermesOptimisticUserTurns,
	projectHermesQueuedFollowUps,
	projectHermesTranscript,
	reconcileHermesOptimisticTurnsWithActiveTurn,
	reconcileHermesOptimisticTurnsWithStockFollowUps,
	reduceHermesComposerAttachments,
	selectHermesFollowUpProjection,
	selectHermesTranscriptWindow,
	settleHermesOptimisticUserTurn,
} from "../src/renderer/hermes/hermes-view-model";
import type {
	HermesRuntimeEvent,
	HermesSessionSummary,
	HermesTagDefinition,
	HermesTranscriptMessage,
} from "../src/shared/hermes";
import { hermesSessionIdentityKey } from "../src/shared/hermes";

const session = (overrides: Partial<HermesSessionSummary> = {}): HermesSessionSummary => ({
	id: "session-1",
	lineageRootId: "session-1",
	activeTipId: "session-1",
	title: "Checkout bug",
	generatedTitle: "Checkout bug",
	titleSource: "generated",
	tags: [],
	metadataRevision: 0,
	preview: "Investigating",
	profileId: "default",
	source: "slack",
	updatedAt: 10,
	createdAt: 1,
	archived: false,
	running: false,
	busy: false,
	waitingForUser: false,
	messageCount: 2,
	isCron: false,
	handover: false,
	admissionReason: null,
	origin: {
		platform: "slack",
		source: "slack",
		displayLabel: "#engineering",
		workspaceLabel: null,
		accountLabel: null,
		chatLabel: null,
		channelLabel: "#engineering",
		threadLabel: null,
		hasThread: true,
		canOpenThread: false,
		canReport: false,
	},
	...overrides,
});

const tag = (id: string, name: string): HermesTagDefinition => ({
	id,
	name,
	normalizedKey: name.toLocaleLowerCase(),
	color: "gray",
	revision: 0,
	createdAt: 1,
	updatedAt: 1,
});

const event = (type: string, payload: Partial<HermesRuntimeEvent> = {}): HermesRuntimeEvent => ({
	type,
	profileId: "work",
	runtimeSessionId: "runtime-1",
	durableSessionId: "session-1",
	turnId: "turn-1",
	requestId: null,
	text: null,
	toolName: null,
	status: null,
	payload: {},
	workspaceArtifacts: [],
	receivedAt: 1,
	...payload,
});

const message = (overrides: Partial<HermesTranscriptMessage> = {}): HermesTranscriptMessage => ({
	id: "assistant-1",
	canonicalMessageId: null,
	compactionGeneration: null,
	active: null,
	compacted: null,
	displayKind: null,
	compactionSummaryType: null,
	turnId: "turn-1",
	role: "assistant",
	text: "Complete update",
	createdAt: 1,
	status: "complete",
	toolName: null,
	workspaceArtifacts: [],
	...overrides,
});

describe("Hermes renderer view model", () => {
	test("uses bounded tail sync for new platform messages and full refresh for ambiguous changes", () => {
		const baseline = {
			durableSessionId: "session-1",
			latestMessageId: "10",
			latestMessageAt: 1_000,
			latestMessageIdIsStable: true,
		};
		expect(decideHermesHistorySync(null, baseline)).toBe("tail");
		expect(decideHermesHistorySync(baseline, baseline)).toBe("none");
		expect(
			decideHermesHistorySync(baseline, {
				...baseline,
				latestMessageId: "12",
				latestMessageAt: 2_000,
			})
		).toBe("tail");
		expect(
			decideHermesHistorySync(baseline, {
				...baseline,
				latestMessageId: "9",
				latestMessageAt: 900,
			})
		).toBe("full");
		expect(
			decideHermesHistorySync(baseline, {
				...baseline,
				latestMessageId: null,
				latestMessageAt: null,
			})
		).toBe("full");
		expect(
			decideHermesHistorySync(baseline, {
				...baseline,
				latestMessageId: null,
				latestMessageAt: 2_000,
				latestMessageIdIsStable: false,
			})
		).toBe("full");
	});

	test("merges a latest history page by physical message identity without duplicates", () => {
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messageIdsAreStable: true,
			messages: [message({ id: "1", text: "old" }), message({ id: "2", text: "stale" })],
		};
		const merged = mergeHermesHistoryTail(current, {
			durableSessionId: "session-1",
			view: "durable",
			total: null,
			complete: false,
			messageIdsAreStable: true,
			messages: [
				message({ id: "2", text: "updated" }),
				message({ id: "3", text: "new", createdAt: 3 }),
			],
		});
		expect(merged.messages.map((entry) => [entry.id, entry.text])).toEqual([
			["1", "old"],
			["2", "updated"],
			["3", "new"],
		]);
		expect(
			mergeHermesHistoryTail(current, {
				...current,
				durableSessionId: "other",
				total: 2,
				complete: true,
				messageIdsAreStable: true,
			})
		).toBe(current);
		expect(
			canMergeHermesHistoryTail(current, {
				...current,
				total: 3,
				complete: false,
				messageIdsAreStable: true,
				messages: [message({ id: "2" }), message({ id: "3" })],
			})
		).toBe(true);
		expect(
			canMergeHermesHistoryTail(current, {
				...current,
				total: 4,
				complete: false,
				messageIdsAreStable: true,
				messages: [message({ id: "2" }), message({ id: "3" })],
			})
		).toBe(false);
		expect(
			canMergeHermesHistoryTail(current, {
				...current,
				total: null,
				complete: false,
				messageIdsAreStable: true,
				messages: [message({ id: "501" })],
			})
		).toBe(false);
	});

	test("rejects unstable or discontinuous partial tails even when one ID overlaps", () => {
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messageIdsAreStable: true,
			messages: [
				message({ id: "1" }),
				message({ id: "2" }),
				message({ id: "3" }),
				message({ id: "4" }),
			],
		};
		const partial = {
			durableSessionId: "session-1",
			view: "durable" as const,
			total: null,
			complete: false,
			messages: [message({ id: "2" }), message({ id: "5" })],
		};

		expect(canMergeHermesHistoryTail(current, { ...partial, messageIdsAreStable: false })).toBe(
			false
		);
		expect(canMergeHermesHistoryTail(current, { ...partial, messageIdsAreStable: true })).toBe(
			false
		);
	});

	test("never treats synthesized IDs in cached history as physical continuity anchors", () => {
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messageIdsAreStable: false,
			messages: [message({ id: "history-0" }), message({ id: "history-1" })],
		};
		const tail = {
			durableSessionId: "session-1",
			view: "durable" as const,
			total: null,
			complete: false,
			messageIdsAreStable: true,
			messages: [message({ id: "history-1" }), message({ id: "physical-2" })],
		};

		expect(applyHermesHistoryTail(current, tail)).toBeNull();
	});

	test("replaces canonical history only from an authoritative complete page", () => {
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messages: [message({ id: "old", text: "Must disappear" })],
		};
		const complete = {
			durableSessionId: "session-1",
			view: "durable" as const,
			total: 1,
			complete: true,
			messageIdsAreStable: false,
			messages: [message({ id: "history-0", text: "Authoritative replacement" })],
		};

		expect(canMergeHermesHistoryTail(current, complete)).toBe(true);
		const replaced = mergeHermesHistoryTail(current, complete);
		expect(replaced.messages).toEqual(complete.messages);
		expect(replaced.messageIdsAreStable).toBe(false);
	});

	test("does not replace durable physical history with a complete active-context page", () => {
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messages: [message({ id: "durable-1" }), message({ id: "durable-2" })],
		};
		const active = {
			durableSessionId: "session-1",
			view: "active" as const,
			total: 1,
			complete: true,
			messageIdsAreStable: true,
			messages: [message({ id: "active-only" })],
		};

		expect(canMergeHermesHistoryTail(current, active)).toBe(false);
		expect(applyHermesHistoryTail(current, active)).toBeNull();
	});

	test("checkpoints a revision only after a tail proves continuity", () => {
		const sync = new HermesHistorySyncCoordinator();
		const selectionKey = JSON.stringify(["manager-connection", "work", "session-1"]);
		const revision = {
			durableSessionId: "session-1",
			latestMessageId: "5",
			latestMessageAt: 5_000,
			latestMessageIdIsStable: true,
		};
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messageIdsAreStable: true,
			messages: [message({ id: "1" }), message({ id: "2" }), message({ id: "3" })],
		};

		expect(sync.decide(selectionKey, revision)).toBe("tail");
		expect(
			sync.applyTail(selectionKey, revision, current, {
				durableSessionId: "session-1",
				view: "durable",
				total: 3,
				complete: false,
				messageIdsAreStable: true,
				messages: [message({ id: "2" }), message({ id: "3" })],
			})
		).toBeNull();
		expect(sync.decide(selectionKey, revision)).toBe("tail");
		expect(
			sync.applyTail(selectionKey, revision, current, {
				durableSessionId: "session-1",
				view: "durable",
				total: null,
				complete: false,
				messageIdsAreStable: true,
				messages: [message({ id: "2" }), message({ id: "5" })],
			})
		).toBeNull();
		expect(sync.decide(selectionKey, revision)).toBe("tail");

		const synchronized = sync.applyTail(selectionKey, revision, current, {
			durableSessionId: "session-1",
			view: "durable",
			total: 5,
			complete: false,
			messageIdsAreStable: true,
			messages: [message({ id: "3" }), message({ id: "4" }), message({ id: "5" })],
		});
		expect(synchronized?.messages.map((entry) => entry.id)).toEqual(["1", "2", "3", "4", "5"]);
		expect(sync.decide(selectionKey, revision)).toBe("none");
	});

	test("does not checkpoint an authoritative page older than its triggering revision", () => {
		const sync = new HermesHistorySyncCoordinator();
		const selectionKey = JSON.stringify(["manager-connection", "work", "session-1"]);
		const revision = {
			durableSessionId: "session-1",
			latestMessageId: "5",
			latestMessageAt: 5_000,
			latestMessageIdIsStable: true,
		};
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messageIdsAreStable: true,
			messages: [message({ id: "1" }), message({ id: "2" })],
		};

		expect(
			sync.applyTail(selectionKey, revision, current, {
				durableSessionId: "session-1",
				view: "durable",
				total: 2,
				complete: true,
				messageIdsAreStable: true,
				messages: current.messages,
			})
		).toBeNull();
		expect(sync.decide(selectionKey, revision)).toBe("tail");
	});

	test("accepts canonical checkpoints only for the exact durable identity", () => {
		const sync = new HermesHistorySyncCoordinator();
		const selectionKey = JSON.stringify(["manager-connection", "work", "session-1"]);
		const revision = {
			durableSessionId: "session-1",
			latestMessageId: "5",
			latestMessageAt: 5_000,
			latestMessageIdIsStable: true,
		};

		expect(
			sync.acceptCanonical(selectionKey, revision, {
				durableSessionId: "other-session",
				view: "durable",
				messageIdsAreStable: true,
				messages: [],
			})
		).toBe(false);
		expect(sync.decide(selectionKey, revision)).toBe("tail");
		expect(
			sync.acceptCanonical(selectionKey, revision, {
				durableSessionId: "session-1",
				view: "durable",
				messageIdsAreStable: true,
				messages: [],
			})
		).toBe(false);
		expect(sync.decide(selectionKey, revision)).toBe("tail");
		expect(
			sync.acceptCanonical(selectionKey, revision, {
				durableSessionId: "session-1",
				view: "durable",
				messageIdsAreStable: true,
				messages: [message({ id: "5" })],
			})
		).toBe(true);
		expect(sync.decide(selectionKey, revision)).toBe("none");
	});

	test("throttles canonical fallback after repeated lightweight revision failures", () => {
		const sync = new HermesHistorySyncCoordinator();
		const selectionKey = JSON.stringify(["manager-connection", "work", "session-1"]);

		expect(sync.recordRevisionFailure(selectionKey, 101, 1_000)).toBe(false);
		expect(sync.recordRevisionFailure(selectionKey, 102, 2_000)).toBe(false);
		expect(sync.recordRevisionFailure(selectionKey, 103, 3_000)).toBe(true);
		expect(sync.recordRevisionFailure(selectionKey, 103, 4_000)).toBe(false);
		expect(
			sync.recordRevisionFailure(
				selectionKey,
				104,
				3_000 + HERMES_HISTORY_CANONICAL_FALLBACK_INTERVAL_MS - 1
			)
		).toBe(false);
		expect(
			sync.recordRevisionFailure(
				selectionKey,
				105,
				3_000 + HERMES_HISTORY_CANONICAL_FALLBACK_INTERVAL_MS
			)
		).toBe(true);
	});

	test("returns no synchronized history for an unsafe partial page", () => {
		const current = {
			durableSessionId: "session-1",
			view: "durable" as const,
			messages: [message({ id: "1" }), message({ id: "2" })],
		};
		expect(
			applyHermesHistoryTail(current, {
				durableSessionId: "session-1",
				view: "durable",
				total: null,
				complete: false,
				messageIdsAreStable: false,
				messages: [message({ id: "2" }), message({ id: "history-1" })],
			})
		).toBeNull();
	});

	test("keeps messaging-style composer controls usable while an active turn runs", () => {
		const policy = hermesComposerInteractionPolicy({
			connected: true,
			running: true,
			submitPending: false,
			attachmentPickerPending: false,
			attachmentAttaching: false,
			hasPayload: true,
		});

		expect(policy).toEqual({
			textareaDisabled: false,
			sendDisabled: false,
			attachmentMutationDisabled: false,
		});
		expect(
			hermesComposerEnterAction({
				connected: true,
				running: true,
				submitPending: false,
				shiftKey: false,
				isComposing: false,
			})
		).toBe("submit");
		expect(
			hermesComposerEnterAction({
				connected: true,
				running: true,
				submitPending: false,
				shiftKey: false,
				isComposing: true,
			})
		).toBe("native");

		expect(
			hermesComposerInteractionPolicy({
				connected: true,
				running: true,
				submitPending: true,
				attachmentPickerPending: false,
				attachmentAttaching: false,
				hasPayload: true,
			})
		).toEqual({
			textareaDisabled: false,
			sendDisabled: true,
			attachmentMutationDisabled: false,
		});
	});

	test("shows pending and accepted continuation turns until new canonical history reconciles them", () => {
		const existing = message({
			id: "existing-identical-user",
			turnId: "turn-old",
			role: "user",
			text: "Please continue",
		});
		const optimistic = createHermesOptimisticUserTurn({
			id: "optimistic-1",
			text: "Please continue",
			attachments: [],
			canonicalMessages: [existing],
		});

		expect(projectHermesOptimisticUserTurns([existing], [optimistic])).toMatchObject([
			{
				id: "optimistic-user:optimistic-1",
				role: "user",
				text: "Please continue",
				delivery: "pending",
			},
		]);
		const accepted = settleHermesOptimisticUserTurn([optimistic], "optimistic-1", "accepted");
		expect(projectHermesOptimisticUserTurns([existing], accepted)).toMatchObject([
			{ id: "optimistic-user:optimistic-1", delivery: "accepted" },
		]);

		const durable = message({
			id: "new-durable-user",
			turnId: "turn-new",
			role: "user",
			text: "Please continue",
		});
		expect(projectHermesOptimisticUserTurns([existing, durable], accepted)).toEqual([]);
		expect(settleHermesOptimisticUserTurn([optimistic], "optimistic-1", "failed")).toEqual([]);
	});

	test("keeps the visible assistant checkpoint before a live redirect bubble", () => {
		const optimistic = createHermesOptimisticUserTurn({
			id: "correction-1",
			text: "Focus on the failing test",
			attachments: [],
			canonicalMessages: [],
			assistantCheckpoint: "I was inspecting the build.",
		});

		expect(projectHermesOptimisticUserTurns([], [optimistic])).toMatchObject([
			{
				id: "optimistic-assistant-checkpoint:correction-1",
				role: "assistant",
				text: "I was inspecting the build.",
			},
			{
				id: "optimistic-user:correction-1",
				role: "user",
				text: "Focus on the failing test",
			},
		]);
	});

	test("projects reconnect corrections at their assistant boundaries and replaces local duplicates", () => {
		const corrections = [
			{
				id: "stock-inflight-correction:session-1:0",
				text: "Use the corrected command",
				assistantTextBefore: "I will restart the old service.",
				knownCanonicalUserMessageIds: [],
			},
		];
		const projected = projectHermesActiveTurn(
			{
				inflightUser: {
					id: "stock-inflight:session-1",
					durableSessionId: "session-1",
					profileId: "work",
					text: "Restart the service",
					attachments: [],
					knownCanonicalUserMessageIds: [],
					status: "accepted",
					error: null,
					createdAt: 0,
				},
				corrections,
			},
			[]
		);

		expect(projected).toMatchObject([
			{ role: "user", text: "Restart the service" },
			{ role: "assistant", text: "I will restart the old service." },
			{ role: "user", text: "Use the corrected command" },
		]);
		const optimistic = createHermesOptimisticUserTurn({
			id: "local-correction",
			text: "Use the corrected command",
			attachments: [],
			canonicalMessages: [],
			assistantCheckpoint: "I will restart the old service.",
		});
		expect(
			reconcileHermesOptimisticTurnsWithActiveTurn([optimistic], {
				inflightUser: null,
				corrections,
			})
		).toEqual([]);
	});

	test("reconciles optimistic bubbles with stock inflight and build-window queue snapshots", () => {
		const original = createHermesOptimisticUserTurn({
			id: "local-original",
			text: "Start the task",
			attachments: [],
			canonicalMessages: [],
		});
		const queued = settleHermesOptimisticUserTurn(
			[
				createHermesOptimisticUserTurn({
					id: "local-queued",
					text: "Run this after startup",
					attachments: [],
					canonicalMessages: [],
				}),
			],
			"local-queued",
			"queued"
		);
		const afterInflight = reconcileHermesOptimisticTurnsWithActiveTurn([original, ...queued], {
			inflightUser: {
				id: "stock-inflight:session-1",
				durableSessionId: "session-1",
				profileId: "work",
				text: "Start the task",
				attachments: [],
				knownCanonicalUserMessageIds: [],
				status: "accepted",
				error: null,
				createdAt: 0,
			},
			corrections: [],
		});
		expect(afterInflight.map((turn) => turn.id)).toEqual(["local-queued"]);

		expect(
			reconcileHermesOptimisticTurnsWithStockFollowUps(afterInflight, [
				{
					id: "stock-queued:session-1",
					durableSessionId: "session-1",
					profileId: "work",
					text: "Run this after startup",
					attachments: [],
					knownCanonicalUserMessageIds: [],
					status: "accepted",
					error: null,
					createdAt: 1,
				},
			])
		).toEqual([]);
	});

	test("keeps queued bubbles ordered and reconciles accepted follow-ups only with new history", () => {
		const existing = message({ id: "existing-user", role: "user", text: "Repeat" });
		const followUp = {
			id: "follow-up-1",
			durableSessionId: "session-1",
			profileId: "work",
			text: "Repeat",
			attachments: [],
			knownCanonicalUserMessageIds: ["existing-user"],
			status: "accepted" as const,
			error: null,
			createdAt: 2,
		};

		expect(projectHermesQueuedFollowUps([existing], [followUp])).toMatchObject([
			{ id: "queued-user:follow-up-1", delivery: "accepted", text: "Repeat" },
		]);
		const canonical = message({ id: "new-user", role: "user", text: "Repeat" });
		expect(projectHermesQueuedFollowUps([existing, canonical], [followUp])).toEqual([]);
		expect(
			projectHermesQueuedFollowUps(
				[existing, canonical],
				[{ ...followUp, id: "follow-up-2", status: "queued" }]
			)
		).toMatchObject([{ id: "queued-user:follow-up-2", delivery: "queued" }]);
	});

	test("keeps the optimistic row authoritative when the queue acknowledges the same client turn", () => {
		const followUp = {
			id: "client-turn-1",
			durableSessionId: "session-1",
			profileId: "default",
			text: "queued prompt",
			attachments: [],
			knownCanonicalUserMessageIds: [],
			status: "queued" as const,
			error: null,
			createdAt: 1,
		};

		const optimistic = settleHermesOptimisticUserTurn(
			[
				createHermesOptimisticUserTurn({
					id: "client-turn-1",
					text: "queued prompt",
					attachments: [],
					canonicalMessages: [],
				}),
			],
			"client-turn-1",
			"queued"
		);
		expect(projectHermesOptimisticUserTurns([], optimistic, [followUp])).toMatchObject([
			{
				id: "optimistic-user:client-turn-1",
				delivery: "queued",
				followUpId: "client-turn-1",
			},
		]);
		expect(
			projectHermesOptimisticUserTurns([], optimistic, [{ ...followUp, status: "accepted" }])
		).toMatchObject([{ id: "optimistic-user:client-turn-1", delivery: "accepted" }]);
		expect(projectHermesQueuedFollowUps([], [followUp], new Set(["client-turn-1"]))).toEqual([]);
		expect(projectHermesQueuedFollowUps([], [followUp], new Set())).toHaveLength(1);
	});

	test("never lets a stale follow-up query regress an authoritative accepted queue event", () => {
		const queued = {
			id: "client-turn-1",
			durableSessionId: "session-1",
			profileId: "default",
			text: "what is your fav food",
			attachments: [],
			knownCanonicalUserMessageIds: [],
			status: "queued" as const,
			error: null,
			createdAt: 1,
		};
		const accepted = { ...queued, status: "accepted" as const };

		expect(selectHermesFollowUpProjection([queued], [accepted], true)).toEqual([accepted]);
		expect(selectHermesFollowUpProjection([queued], [], false)).toEqual([queued]);
	});

	test("deduplicates retained physical copies by canonical identity across compactions", () => {
		const timeline = deriveHermesCanonicalTimeline([
			message({
				id: "physical-original",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 0,
				active: false,
				compacted: true,
				role: "user",
				text: "Original question",
			}),
			message({ id: "answer-original", canonicalMessageId: "canonical-answer" }),
			message({
				id: "summary-one",
				canonicalMessageId: "canonical-summary-one",
				displayKind: "compaction_summary",
				text: "First summary",
			}),
			message({
				id: "physical-copy-one",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 1,
				active: false,
				compacted: true,
				role: "user",
				text: "Copy content must not replace the first row",
			}),
			message({
				id: "summary-two",
				canonicalMessageId: "canonical-summary-two",
				displayKind: "compaction_summary",
				text: "Second summary",
			}),
			message({
				id: "physical-copy-two",
				canonicalMessageId: "canonical-question",
				compactionGeneration: 2,
				active: true,
				compacted: false,
				role: "user",
				text: "Another retained copy",
			}),
			message({ id: "new-tail", canonicalMessageId: "canonical-tail", text: "New tail" }),
		]);

		expect(timeline.map((entry) => entry.id)).toEqual([
			"physical-original",
			"answer-original",
			"summary-one",
			"summary-two",
			"new-tail",
		]);
		expect(timeline[0]).toMatchObject({
			text: "Original question",
			physicalRows: [
				{ id: "physical-original", active: false, compacted: true, compactionGeneration: 0 },
				{ id: "physical-copy-one", active: false, compacted: true, compactionGeneration: 1 },
				{ id: "physical-copy-two", active: true, compacted: false, compactionGeneration: 2 },
			],
		});
	});

	test("keeps same-content physical rows distinct when canonical identity is absent", () => {
		const timeline = deriveHermesCanonicalTimeline([
			message({ id: "same-one", canonicalMessageId: null, text: "Repeated" }),
			message({ id: "same-two", canonicalMessageId: null, text: "Repeated" }),
		]);

		expect(timeline.map((entry) => entry.id)).toEqual(["same-one", "same-two"]);
		expect(timeline.map((entry) => entry.physicalRows)).toEqual([
			[expect.objectContaining({ id: "same-one" })],
			[expect.objectContaining({ id: "same-two" })],
		]);
	});

	test("groups an implicit original ID with explicit canonical copies", () => {
		const timeline = deriveHermesCanonicalTimeline([
			message({ id: "7", canonicalMessageId: null, role: "user", text: "Original seven" }),
			message({
				id: "91",
				canonicalMessageId: "7",
				role: "user",
				text: "Retained copy",
			}),
		]);

		expect(timeline).toHaveLength(1);
		expect(timeline[0]).toMatchObject({
			id: "7",
			text: "Original seven",
			physicalRows: [{ id: "7" }, { id: "91", canonicalMessageId: "7" }],
		});
	});

	test("uses a later original as display source at the copy's earliest timeline position", () => {
		const timeline = deriveHermesCanonicalTimeline([
			message({ id: "before", canonicalMessageId: null, text: "Before" }),
			message({ id: "91", canonicalMessageId: "7", role: "user", text: "Copy first" }),
			message({ id: "between", canonicalMessageId: null, text: "Between" }),
			message({ id: "7", canonicalMessageId: null, role: "user", text: "Original later" }),
			message({ id: "after", canonicalMessageId: null, text: "After" }),
		]);

		expect(timeline.map((entry) => entry.id)).toEqual(["before", "7", "between", "after"]);
		expect(timeline[1]).toMatchObject({
			id: "7",
			text: "Original later",
			physicalRows: [{ id: "91" }, { id: "7" }],
		});
	});

	test("accumulates a large canonical group without full-array cloning", async () => {
		const messages = Array.from({ length: 10_000 }, (_, index) =>
			message({ id: `copy-${index}`, canonicalMessageId: "canonical-large" })
		);

		const [canonical] = deriveHermesCanonicalTimeline(messages);
		expect(canonical?.physicalRows).toHaveLength(10_000);

		const source = await Bun.file(
			new URL("../src/renderer/hermes/hermes-view-model.ts", import.meta.url)
		).text();
		expect(source).not.toContain("physicalRows: [...existing.physicalRows");
	});

	test("does not retain opaque display metadata in canonical physical row state", () => {
		const unsafeMessage = {
			...message({ id: "physical-row" }),
			displayMetadata: {
				raw: "physical-row-innocent-key-secret",
			},
		} as HermesTranscriptMessage;

		const [canonical] = deriveHermesCanonicalTimeline([unsafeMessage]);

		expect(canonical?.physicalRows[0]).not.toHaveProperty("displayMetadata");
		expect(JSON.stringify(canonical?.physicalRows)).not.toContain("innocent-key-secret");
	});

	test("projects only user turns and substantive assistant prose into conversation", () => {
		const canonical = [
			message({ id: "system-1", role: "system", text: "Session resumed" }),
			message({ id: "tool-1", role: "tool", text: "Checked status", toolName: "terminal" }),
			message({ id: "assistant-empty", text: "   " }),
			message({ id: "user-1", role: "user", text: "Please continue" }),
			message({ id: "assistant-prose", text: "Tool: this is still assistant prose." }),
			message({
				id: "assistant-artifact",
				text: "",
				workspaceArtifacts: [
					{
						kind: "superiorswarm.workspace.created",
						workspaceId: "workspace-1",
						projectId: "project-1",
						branch: "feat/chat",
						worktreePath: "/tmp/worktree",
					},
				],
			}),
		];
		const snapshot = structuredClone(canonical);

		const projected = projectHermesTranscript(canonical);

		expect(projected.map((item) => [item.kind, item.id])).toEqual([
			["activity", "activity:system-1"],
			["message", "user:user-1"],
			["message", "assistant:assistant-prose"],
			["activity", "activity:assistant-artifact"],
		]);
		expect(projected[0]).toMatchObject({
			kind: "activity",
			messages: [{ id: "system-1" }, { id: "tool-1" }, { id: "assistant-empty" }],
		});
		expect(projected[2]).toMatchObject({
			kind: "message",
			role: "assistant",
			text: "Tool: this is still assistant prose.",
		});
		expect(canonical).toEqual(snapshot);
	});

	test("does not join activity across any user boundary", () => {
		const projected = projectHermesTranscript([
			message({ id: "tool-before", role: "tool", toolName: "read", text: "before" }),
			message({ id: "empty-user", role: "user", text: "" }),
			message({ id: "tool-after", role: "tool", toolName: "write", text: "after" }),
		]);

		expect(projected).toHaveLength(3);
		expect(projected.map((item) => item.id)).toEqual([
			"activity:tool-before",
			"activity:empty-user",
			"activity:tool-after",
		]);
	});

	test("keeps failed assistant scaffolding in activity and reports a textual failure summary", () => {
		const failed = message({
			id: "assistant-failed",
			text: "Provider returned a failure",
			status: "failed",
		});

		expect(classifyHermesTranscriptMessage(failed).kind).toBe("activity");
		expect(hermesActivitySummary([failed])).toEqual({
			status: "failed",
			text: "Action failed",
		});
	});

	test("preserves JSON-looking quoted prose without using content prefixes for classification", () => {
		const quoted = message({ id: "assistant-quoted", text: '"System: quoted prose"' });

		expect(classifyHermesTranscriptMessage(quoted)).toMatchObject({
			kind: "assistant",
			text: '"System: quoted prose"',
		});
		expect(projectHermesTranscript([quoted])[0]).toMatchObject({
			kind: "message",
			text: '"System: quoted prose"',
		});
	});

	test("classifies only structural display metadata as ordered compaction events", () => {
		const firstSummary = message({
			id: "summary-one",
			role: "user",
			text: "First compacted context",
			compactionGeneration: 1,
			displayKind: "compaction_summary",
			compactionSummaryType: "standalone",
		});
		const secondSummary = message({
			id: "summary-two",
			text: "Second compacted context",
			compactionGeneration: 2,
			displayKind: "compaction_summary",
			compactionSummaryType: "merged",
		});
		const prefixOnly = message({
			id: "prefix-only",
			text: "Summary of the conversation so far: ordinary assistant prose",
		});

		expect(classifyHermesTranscriptMessage(firstSummary)).toMatchObject({
			kind: "compaction",
			text: "First compacted context",
		});
		expect(classifyHermesTranscriptMessage(prefixOnly).kind).toBe("assistant");
		expect(
			projectHermesTranscript([
				message({ id: "before", role: "user", text: "Before" }),
				firstSummary,
				message({ id: "between", text: "Between" }),
				secondSummary,
				prefixOnly,
			]).map((item) => [item.kind, item.id])
		).toEqual([
			["message", "user:before"],
			["compaction", "compaction:summary-one"],
			["message", "assistant:between"],
			["compaction", "compaction:summary-two"],
			["message", "assistant:prefix-only"],
		]);
	});

	test("defines overflow containment for the canvas while isolating technical horizontal scroll", () => {
		const pathological = `https://example.invalid/${"x".repeat(4_096)}`;
		const projected = projectHermesTranscript([message({ id: "long", text: pathological })]);

		expect(projected[0]).toMatchObject({ text: pathological });
		expect(HERMES_CHAT_OVERFLOW_CLASSES.ancestor).toContain("min-w-0");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner).toContain("overflow-x-hidden");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.arbitraryContent).toContain("overflow-wrap:anywhere");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.technicalDetail).toContain("overflow-x-auto");
		expect(HERMES_CHAT_OVERFLOW_CLASSES.transcriptOwner).not.toContain("overflow-x-auto");
	});

	test("shows current live tools as one activity group and drops them after durable reconciliation", () => {
		const current = {
			...createHermesLiveState(),
			running: true,
			tools: [
				{
					id: "rpc-1",
					turnId: "turn-live",
					name: "read_file",
					status: "complete" as const,
				},
				{
					id: "rpc-2",
					turnId: "turn-live",
					name: "terminal",
					status: "running" as const,
				},
			],
		};

		expect(projectHermesLiveActivity(current)).toMatchObject({
			kind: "activity",
			id: "activity:live:rpc-1",
			status: "running",
			summary: "Running 2 actions",
		});
		expect(projectHermesLiveActivity({ ...current, running: false })).toBeNull();
		expect(
			projectHermesLiveActivity(current, [
				message({
					id: "durable-tool-1",
					turnId: "turn-live",
					role: "tool",
					toolName: "read_file",
					text: "result",
				}),
			])
		).toMatchObject({
			messages: [{ id: "rpc-2", toolName: "terminal" }],
			summary: "Running 1 action",
		});
	});

	test("keeps a completed live reply visible only until canonical history reconciles it", () => {
		const completed = [
			{ turnId: "turn-live", text: "Finished live reply", canonicalMessageIds: [] },
		];

		expect(projectHermesLiveCompletions([], completed)).toEqual([
			expect.objectContaining({
				kind: "message",
				id: "assistant:live-complete:turn-live",
				text: "Finished live reply",
			}),
		]);
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical", turnId: "turn-live", text: "Finished live reply" })],
				completed
			)
		).toEqual([]);
	});

	test("does not duplicate an untagged completion when history refresh wins the terminal race", () => {
		const before = [message({ id: "old-assistant", text: "Earlier reply" })];
		const durableReply = message({ id: "new-assistant", text: "Finished live reply" });
		let state = applyHermesEvent(
			createHermesLiveState(),
			event("message.start"),
			undefined,
			before
		);
		state = applyHermesEvent(
			state,
			event("message.complete", { turnId: null, text: "Finished live reply" }),
			undefined,
			[...before, durableReply]
		);

		expect(projectHermesLiveCompletions([...before, durableReply], state.completed)).toEqual([]);
	});

	test("reconciles refreshed canonical prose only when stable turn identity does not conflict", () => {
		const completed = [
			{ turnId: "turn-live", text: "Authoritative reply", canonicalMessageIds: ["before"] },
		];

		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-missing", turnId: null, text: "Authoritative reply" })],
				completed
			)
		).toEqual([]);
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-different", turnId: "turn-stock", text: "Authoritative reply" })],
				completed
			)
		).toEqual([
			expect.objectContaining({
				id: "assistant:live-complete:turn-live",
				text: "Authoritative reply",
			}),
		]);
	});

	test("does not hide distinct same-text turns and consumes canonical fallbacks once", () => {
		const oldCanonical = message({ id: "canonical-old", turnId: "turn-old", text: "Same reply" });
		const distinct = [
			{
				turnId: "turn-new",
				text: "Same reply",
				canonicalMessageIds: ["canonical-old"],
			},
		];
		expect(projectHermesLiveCompletions([oldCanonical], distinct)).toEqual([
			expect.objectContaining({ id: "assistant:live-complete:turn-new" }),
		]);

		const repeated = [
			{ turnId: "turn-a", text: "Same reply", canonicalMessageIds: [] },
			{ turnId: "turn-b", text: "Same reply", canonicalMessageIds: [] },
		];
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-one", turnId: "turn-stock", text: "Same reply" })],
				repeated
			)
		).toEqual([
			expect.objectContaining({ id: "assistant:live-complete:turn-a" }),
			expect.objectContaining({ id: "assistant:live-complete:turn-b" }),
		]);
		expect(
			projectHermesLiveCompletions(
				[message({ id: "canonical-one", turnId: null, text: "Same reply" })],
				repeated
			)
		).toEqual([expect.objectContaining({ id: "assistant:live-complete:turn-b" })]);
	});

	test("keeps a live reply when durable refresh reveals an equivalent archived physical row", () => {
		const refreshed = deriveHermesCanonicalTimeline([
			message({
				id: "archived-origin",
				canonicalMessageId: "canonical-old-reply",
				active: false,
				compacted: true,
				turnId: "turn-old",
				text: "Same reply",
			}),
			message({
				id: "retained-active-copy",
				canonicalMessageId: "canonical-old-reply",
				active: true,
				compacted: false,
				turnId: "turn-old",
				text: "Same reply",
			}),
			message({
				id: "summary-after-old-reply",
				canonicalMessageId: "canonical-summary",
				displayKind: "compaction_summary",
				text: "Earlier context",
			}),
		]);

		const pending = projectHermesLiveCompletions(refreshed, [
			{
				turnId: "turn-new",
				text: "Same reply",
				canonicalMessageIds: ["retained-active-copy"],
			},
		]);

		expect(refreshed.map((entry) => entry.id)).toEqual([
			"archived-origin",
			"summary-after-old-reply",
		]);
		expect(pending).toEqual([expect.objectContaining({ id: "assistant:live-complete:turn-new" })]);
	});

	test("adds multiple opaque attachments and removes one before send", () => {
		const initial = reduceHermesComposerAttachments([], {
			type: "add",
			attachments: [
				{
					handle: "opaque-image",
					name: "screen.png",
					size: 3,
					mimeType: "image/png",
					kind: "image",
					expiresAt: 10,
				},
				{
					handle: "opaque-file",
					name: "notes.txt",
					size: 5,
					mimeType: "text/plain",
					kind: "file",
					expiresAt: 10,
				},
			],
		});

		expect(initial.map((attachment) => attachment.status)).toEqual(["ready", "ready"]);
		expect(
			reduceHermesComposerAttachments(initial, { type: "remove", handle: "opaque-image" })
		).toEqual([expect.objectContaining({ handle: "opaque-file" })]);
		const submitting = reduceHermesComposerAttachments(initial, { type: "submitting" });
		expect(
			reduceHermesComposerAttachments(submitting, { type: "remove", handle: "opaque-image" })
		).toEqual(submitting);
	});

	test("stages pasted and dropped files while leaving text-only paste native", () => {
		expect(hermesComposerContainsFiles({ types: ["Files"], files: { length: 0 } })).toBe(true);
		expect(hermesComposerContainsFiles({ items: { 0: { kind: "file" }, length: 1 } })).toBe(true);
		expect(hermesComposerContainsFiles({ files: { length: 1 } })).toBe(true);
		expect(hermesComposerContainsFiles({ types: ["text/plain"], files: { length: 0 } })).toBe(
			false
		);
		expect(hermesComposerTransferAction({ files: { length: 1 } })).toBe("stage-files");
		expect(hermesComposerTransferAction({ types: ["text/plain"], files: { length: 0 } })).toBe(
			"native"
		);
		expect(
			hermesRendererAttachmentSelectionError(
				[{ name: "screen.png", size: 4, type: "image/png" }],
				0
			)
		).toBeNull();
		expect(
			hermesRendererAttachmentSelectionError(
				[{ name: "screen.png", size: 17 * 1024 * 1024, type: "image/png" }],
				0
			)
		).toContain("16 MiB");
	});

	test("retains selected attachments with an error for retry and clears only on success", () => {
		const ready = reduceHermesComposerAttachments([], {
			type: "add",
			attachments: [
				{
					handle: "opaque-file",
					name: "notes.txt",
					size: 5,
					mimeType: "text/plain",
					kind: "file",
					expiresAt: 10,
				},
			],
		});
		const attaching = reduceHermesComposerAttachments(ready, { type: "submitting" });
		const failed = reduceHermesComposerAttachments(attaching, {
			type: "failed",
			error: "Hermes could not attach the file",
		});

		expect(failed).toEqual([
			expect.objectContaining({
				handle: "opaque-file",
				status: "error",
				error: "Hermes could not attach the file",
			}),
		]);
		expect(reduceHermesComposerAttachments(failed, { type: "succeeded" })).toEqual([]);
	});

	test("presents submitted attachment metadata as chips without wrapper noise", () => {
		const wrapped = [
			"[SuperiorSwarm attachments]",
			'{"kind":"image","name":"screen.png"}',
			'{"kind":"file","name":"notes.txt","ref":"@file:attachments/notes.txt"}',
			'{"kind":"file","name":"unsafe.txt","ref":"@file:../backend/private.txt"}',
			"[/SuperiorSwarm attachments]",
			"",
			"Please review these",
		].join("\n");
		const projected = projectHermesTranscript([
			message({ id: "user-attachments", role: "user", text: wrapped }),
		]);

		expect(projected[0]).toMatchObject({
			kind: "message",
			role: "user",
			text: "Please review these",
			attachments: [
				{
					id: "user-attachments:attachment:0",
					kind: "image",
					name: "screen.png",
					refText: null,
				},
				{
					id: "user-attachments:attachment:1",
					kind: "file",
					name: "notes.txt",
					refText: "@file:attachments/notes.txt",
				},
				{
					id: "user-attachments:attachment:2",
					kind: "file",
					name: "unsafe.txt",
					refText: null,
				},
			],
		});
	});

	test("groups messaging handovers separately while retaining ordinary sessions", () => {
		const local = session({ id: "local", source: "superiorswarm", handover: false });
		const telegram = session({ id: "telegram", source: "telegram", handover: true });
		const custom = session({ id: "custom", source: "custom_adapter", handover: true });

		expect(groupHermesSessions([local, telegram, custom])).toEqual({
			handovers: [telegram, custom],
			sessions: [local],
		});
	});

	test("hides loopback token entry and enables save without renderer credentials", () => {
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "http://127.0.0.1:8080",
				hasStoredToken: false,
				storedBaseUrl: null,
				tokenInput: "",
			})
		).toEqual({ showTokenInput: false, canSave: true });
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "https://hermes.example.com",
				hasStoredToken: false,
				storedBaseUrl: null,
				tokenInput: "",
			})
		).toEqual({ showTokenInput: true, canSave: false });
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "https://hermes.example.com",
				hasStoredToken: false,
				storedBaseUrl: null,
				tokenInput: "explicit-remote-token",
			})
		).toEqual({ showTokenInput: true, canSave: true });
		expect(
			hermesConnectionFormPolicy({
				baseUrl: "https://hermes.example.com",
				hasStoredToken: true,
				storedBaseUrl: "http://127.0.0.1:8080",
				tokenInput: "",
			})
		).toEqual({ showTokenInput: true, canSave: false });
	});

	test("filters active/archived sessions and searches source, profile, origin, or linked branch", () => {
		const active = session({
			tags: [tag("customer", "customer report"), tag("follow-up", "needs follow-up")],
		});
		const archived = session({ id: "session-2", title: "Release", archived: true });
		const sessions = [active, archived];
		expect(filterHermesSessions(sessions, "open", "engineering", {})).toEqual([active]);
		expect(filterHermesSessions(sessions, "open", "customer report", {})).toEqual([active]);
		expect(
			filterHermesSessions(sessions, "all", "feat/payments", {
				[hermesSessionIdentityKey("default", "session-2")]: ["feat/payments"],
			})
		).toEqual([archived]);
		expect(filterHermesSessions(sessions, "archived", "default", {})).toEqual([archived]);
	});

	test("searches linked workspace metadata by composite profile and session identity", () => {
		const work = session({ id: "shared-session", profileId: "work", title: "Shared" });
		const personal = session({ id: "shared-session", profileId: "personal", title: "Shared" });
		const linkedMetadata = {
			[hermesSessionIdentityKey("work", "shared-session")]: ["feat/work-only"],
			[hermesSessionIdentityKey("personal", "shared-session")]: ["feat/personal-only"],
		};

		expect(filterHermesSessions([work, personal], "all", "feat/work-only", linkedMetadata)).toEqual(
			[work]
		);
		expect(
			filterHermesSessions([work, personal], "all", "feat/personal-only", linkedMetadata)
		).toEqual([personal]);
	});

	test("moves a canonically refreshed archive between Open and Archived without local hiding", () => {
		const open = session({ id: "managed-session", archived: false });
		const archived = { ...open, archived: true };

		expect(filterHermesSessions([open], "open", "", {})).toEqual([open]);
		expect(filterHermesSessions([open], "archived", "", {})).toEqual([]);
		expect(filterHermesSessions([archived], "open", "", {})).toEqual([]);
		expect(filterHermesSessions([archived], "archived", "", {})).toEqual([archived]);
		expect(filterHermesSessions([open], "open", "", {})).toEqual([open]);
	});

	test("reduces streaming, tool, approval, clarification, and completion events", () => {
		let state = createHermesLiveState();
		state = applyHermesEvent(state, event("message.delta", { text: "Hel" }));
		state = applyHermesEvent(state, event("message.delta", { text: "lo" }));
		state = applyHermesEvent(state, event("tool.start", { toolName: "create_worktree" }));
		state = applyHermesEvent(
			state,
			event("approval.request", { requestId: "approval-1", text: "Allow command?" })
		);
		state = applyHermesEvent(
			state,
			event("clarify.request", { requestId: "clarify-1", text: "Which repo?" })
		);
		expect(state.streamingText).toBe("Hello");
		expect(state.running).toBe(true);
		expect(state.tools[0]?.status).toBe("running");
		expect(state.pendingApproval?.requestId).toBe("approval-1");
		expect(state.pendingClarification?.requestId).toBe("clarify-1");

		state = applyHermesEvent(state, event("tool.complete", { toolName: "create_worktree" }));
		state = applyHermesEvent(
			state,
			event("message.complete", { text: "Hello world", status: "complete" })
		);
		expect(state.running).toBe(false);
		expect(state.streamingText).toBe("");
		expect(state.completed.at(-1)).toEqual({
			turnId: "turn-1",
			text: "Hello world",
			canonicalMessageIds: [],
		});
		expect(state.tools[0]?.status).toBe("complete");
	});

	test("retains native subagent progress and ignores late non-terminal regression", () => {
		const payload = {
			subagentId: "child-1",
			parentId: null,
			childSessionId: "child-session",
			goal: "Inspect queue behavior",
			model: "hermes-test",
			status: "running" as const,
			taskIndex: 0,
			taskCount: 1,
			depth: 1,
			toolCount: 2,
			durationSeconds: null,
			costUsd: null,
			inputTokens: null,
			outputTokens: null,
			summary: null,
			filesRead: ["gateway/run.py"],
			filesWritten: [],
		};
		let state = applyHermesEvent(
			createHermesLiveState(),
			event("subagent.progress", {
				text: "Reading the queue",
				toolName: "search",
				payload: { subagent: payload },
				receivedAt: 10,
			})
		);
		expect(state.subagents).toEqual([
			expect.objectContaining({
				subagentId: "child-1",
				status: "running",
				latestText: "Reading the queue",
				currentTool: "search",
			}),
		]);

		state = applyHermesEvent(
			state,
			event("subagent.complete", {
				text: "Queue inspection complete",
				payload: {
					subagent: { ...payload, status: "completed", summary: "Found the race" },
				},
				receivedAt: 20,
			})
		);
		state = applyHermesEvent(
			state,
			event("subagent.progress", {
				text: "late progress",
				payload: { subagent: payload },
				receivedAt: 21,
			})
		);
		expect(state.subagents[0]).toMatchObject({
			status: "completed",
			summary: "Found the race",
			latestText: "Queue inspection complete",
			currentTool: null,
		});

		state = applyHermesEvent(state, event("message.start"));
		expect(state.subagents).toEqual([]);
		expect(state.running).toBe(true);
	});

	test("requests canonical refresh after a reconnect", () => {
		const state = applyHermesEvent(
			createHermesLiveState(),
			event("runtime.history-refresh-required", { runtimeSessionId: null })
		);
		expect(state.historyRefreshRequired).toBe(true);
	});

	test("replaces partial deltas with a complete active-turn snapshot", () => {
		const partial = {
			...createHermesLiveState(),
			running: true,
			runtimeStatus: "streaming",
			streamingText: "answer accumulated",
		};
		const replayed = applyHermesEvent(
			partial,
			event("runtime.active-turn-snapshot", {
				payload: {
					activeTurnSnapshot: {
						durableSessionId: "session-1",
						runtimeSessionId: "runtime-2",
						eventSeq: 1_250,
						activeTurn: true,
						status: "streaming",
						turnId: "turn-live",
						streamingText: "Complete answer accumulated before reconnect",
						tools: [
							{
								id: "tool-live",
								turnId: "turn-live",
								name: "terminal",
								status: "complete",
							},
						],
						pendingApproval: null,
						pendingClarification: null,
						queuedFollowUps: [],
					},
				},
			})
		);

		expect(replayed).toMatchObject({
			running: true,
			runtimeStatus: "streaming",
			streamingText: "Complete answer accumulated before reconnect",
			tools: [{ id: "tool-live", name: "terminal", status: "complete" }],
		});
	});

	test("replaces stale interaction controls with the snapshot's unresolved state", () => {
		const stale = {
			...createHermesLiveState(),
			pendingApproval: { requestId: "resolved", prompt: "Old approval", choices: [] },
			pendingClarification: { requestId: "expired", prompt: "Old question", choices: [] },
		};
		const restored = applyHermesEvent(
			stale,
			event("runtime.active-turn-snapshot", {
				payload: {
					activeTurnSnapshot: {
						durableSessionId: "session-1",
						runtimeSessionId: "runtime-2",
						eventSeq: 42,
						activeTurn: true,
						status: "working",
						turnId: "turn-live",
						streamingText: "",
						tools: [],
						pendingApproval: null,
						pendingClarification: {
							requestId: "clarify-current",
							prompt: "Which environment?",
							choices: [{ value: "staging", label: "Staging" }],
						},
						queuedFollowUps: [],
					},
				},
			})
		);

		expect(restored.pendingApproval).toBeNull();
		expect(restored.pendingClarification).toEqual({
			requestId: "clarify-current",
			prompt: "Which environment?",
			choices: [{ value: "staging", label: "Staging" }],
		});
	});

	test("reconciles selected-session busy state from authoritative reconnect bindings", () => {
		const idleReconnect = event("runtime.history-refresh-required", {
			runtimeSessionId: null,
			durableSessionId: null,
			status: "reconnected",
			payload: {
				bindings: [
					{
						hermesSessionId: "session-1",
						durableSessionId: "session-1",
						runtimeSessionId: "runtime-2",
						activeTurn: false,
						status: "idle",
					},
				],
			} as HermesRuntimeEvent["payload"],
		});
		const idle = applyHermesEvent(
			{ ...createHermesLiveState(), running: true, runtimeStatus: "streaming" },
			idleReconnect,
			"session-1"
		);
		expect(idle).toMatchObject({
			running: false,
			runtimeStatus: "idle",
			historyRefreshRequired: true,
		});

		const runningReconnect = event("runtime.history-refresh-required", {
			...idleReconnect,
			payload: {
				bindings: [
					{
						hermesSessionId: "session-1",
						durableSessionId: "session-1",
						runtimeSessionId: "runtime-3",
						activeTurn: true,
						status: "working",
					},
				],
			} as HermesRuntimeEvent["payload"],
		});
		const running = applyHermesEvent(createHermesLiveState(), runningReconnect, "session-1");
		expect(running).toMatchObject({ running: true, runtimeStatus: "working" });
	});

	test("surfaces queued, failed, interrupted, and expired stock runtime states", () => {
		let state = applyHermesEvent(
			createHermesLiveState(),
			event("session.info", { status: "queued" })
		);
		expect(state).toMatchObject({ running: true, runtimeStatus: "queued" });
		state = {
			...state,
			pendingApproval: { requestId: "approval-current", prompt: "Approve", choices: [] },
		};
		state = applyHermesEvent(state, event("approval.expire", { requestId: "approval-older" }));
		expect(state.pendingApproval?.requestId).toBe("approval-current");
		state = applyHermesEvent(state, event("approval.expire", { requestId: "approval-current" }));
		expect(state.pendingApproval).toBeNull();
		state = applyHermesEvent(state, event("turn.failed", { text: "Provider rejected" }));
		expect(state).toMatchObject({ running: false, error: "Provider rejected" });
		state = applyHermesEvent({ ...state, running: true, error: null }, event("turn.cancelled"));
		expect(state).toMatchObject({ running: false, error: "Hermes turn was interrupted" });
	});

	test("keeps response values and safely formatted labels for server choices", () => {
		const state = applyHermesEvent(
			createHermesLiveState(),
			event("approval.request", {
				requestId: "approval-choices",
				text: "Deploy to production?",
				payload: {
					choices: [
						{ value: "allow_once", label: "Allow this deployment" },
						{ value: "deny", label: "Stop and return to the agent" },
					],
				},
			})
		);
		expect(state.pendingApproval?.choices).toEqual([
			{ value: "allow_once", label: "Allow this deployment" },
			{ value: "deny", label: "Stop and return to the agent" },
		]);
	});

	test("provides conservative generic approval choices when Hermes omits them", () => {
		const state = applyHermesEvent(createHermesLiveState(), event("approval.request"));
		expect(state.pendingApproval?.choices).toEqual([
			{ value: "allow_once", label: "Allow once" },
			{ value: "deny", label: "Deny" },
		]);
	});

	test("does not offer failed or non-assistant history as a report update", () => {
		expect(
			latestReportableHermesMessage([
				message({ id: "assistant-ok", createdAt: 100 }),
				message({
					id: "assistant-tool-wrapper",
					toolName: "terminal",
					text: "This must remain activity",
					createdAt: 200,
				}),
				message({ id: "assistant-failed", status: "failed", createdAt: 300 }),
				message({ id: "assistant-empty", text: "   ", createdAt: 350 }),
				message({ id: "user-1", role: "user", createdAt: 400 }),
			])
		).toMatchObject({ id: "assistant-ok" });
	});

	test("uses only the resolved redacted projection for optional origin actions", () => {
		expect(
			hermesOriginActionAvailability({
				platform: "slack",
				source: "slack",
				displayLabel: "Slack",
				workspaceLabel: null,
				accountLabel: null,
				chatLabel: null,
				channelLabel: null,
				threadLabel: null,
				hasThread: true,
				canOpenThread: true,
				canReport: true,
			})
		).toEqual({ canOpenOrigin: true, canReportToOrigin: true });
		expect(hermesOriginActionAvailability(undefined)).toEqual({
			canOpenOrigin: false,
			canReportToOrigin: false,
		});
		expect(
			hermesOriginReturnLabel({
				platform: "slack",
				source: "slack",
				displayLabel: "#release",
				workspaceLabel: null,
				accountLabel: null,
				chatLabel: null,
				channelLabel: "#release",
				threadLabel: null,
				hasThread: true,
				canOpenThread: true,
				canReport: false,
			})
		).toBe("Return to Slack");
		expect(
			hermesOriginReturnLabel({
				platform: "telegram",
				source: "telegram",
				displayLabel: "Telegram",
				workspaceLabel: null,
				accountLabel: null,
				chatLabel: null,
				channelLabel: null,
				threadLabel: null,
				hasThread: true,
				canOpenThread: true,
				canReport: false,
			})
		).toBe("Return to Telegram");
		expect(hermesOriginReturnLabel(undefined)).toBeNull();
	});

	test("requires explicit retry for retryable failed and orphaned-sending receipts", () => {
		expect(hermesReportRequiresExplicitRetry({ status: "failed", retryable: true })).toBe(true);
		expect(hermesReportRequiresExplicitRetry({ status: "sending", retryable: true })).toBe(true);
		expect(hermesReportRequiresExplicitRetry({ status: "sending", retryable: false })).toBe(false);
		expect(hermesReportRequiresExplicitRetry(null)).toBe(false);
	});

	test("bounds oversized transcripts by render weight while preserving the latest context", () => {
		const items = projectHermesTranscript(
			Array.from({ length: 1_500 }, (_, index) =>
				message({ id: `message-${index}`, text: `${index}:${"x".repeat(1_024)}` })
			)
		);
		const first = selectHermesTranscriptWindow(items);
		const second = selectHermesTranscriptWindow(items, 2);

		expect(first.windowed).toBe(true);
		expect(first.items.length).toBeGreaterThanOrEqual(30);
		expect(first.items.length).toBeLessThan(500);
		expect(first.items.at(-1)?.id).toBe("assistant:message-1499");
		expect(second.items.length).toBeGreaterThan(first.items.length);
		const small = items.slice(-10);
		expect(selectHermesTranscriptWindow(small).items).toBe(small);
	});

	test("bounds a 500-session sidebar to the viewport plus stock overscan", () => {
		expect(hermesSessionVirtualRange(24, 0, 600)).toEqual({ start: 0, end: 24 });
		const middle = hermesSessionVirtualRange(500, 10_000, 600);
		expect(middle.start).toBeGreaterThan(0);
		expect(middle.end).toBeLessThan(500);
		expect(middle.end - middle.start).toBeLessThan(40);
		expect(hermesSessionVirtualRange(500, 0, 600)).toEqual({ start: 0, end: 23 });
	});
});
