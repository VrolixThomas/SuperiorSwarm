import { and, eq, inArray } from "drizzle-orm";
import type { ActivityQueueCandidate, ActivityQueueTarget } from "../../shared/activity-queue";
import type { AgentEvent } from "../../shared/agent-events";
import { AGENT_PROVIDERS } from "../../shared/agent-session";
import { getDb } from "../db";
import { agentMessages, agentSessions, projects, terminalSessions } from "../db/schema";
import { activityQueueSources } from "../db/schema-activity-queue";
import { type AgentEventSnapshot, nextAgentEventSnapshot } from "./agent-event-order";
import { transitionAgentEvent } from "./agent-event-transition";
import { queueEntities } from "./entities";
import { isQuestionAnswer } from "./question-answers";
import { ActivityQueueService } from "./service";

export type WorkspaceReporter = Extract<ActivityQueueTarget, { type: "terminal" }>;

/** A reported terminal must be registered to this exact workspace and conversation. */
export function workspaceReporter(
	workspaceId: string,
	terminalId?: string
): WorkspaceReporter | null {
	if (!terminalId || !queueEntities().has(workspaceId)) return null;
	const db = getDb();
	const terminal = db
		.select()
		.from(terminalSessions)
		.where(eq(terminalSessions.id, terminalId))
		.get();
	const session = db
		.select()
		.from(agentSessions)
		.where(eq(agentSessions.terminalId, terminalId))
		.get();
	if (
		terminal?.workspaceId !== workspaceId ||
		session?.workspaceId !== workspaceId ||
		!session.providerSessionId ||
		session.entityKind !== queueEntities().get(workspaceId)?.entity.kind
	)
		return null;
	return {
		type: "terminal",
		entity: queueEntities().get(workspaceId)?.entity,
		workspaceId,
		terminalId,
		provider: session.provider,
		providerSessionId: session.providerSessionId,
	};
}

/** Explicit working status from a bound chat is proof of continuation even if a prompt hook was missed. */
export function resolveReporterAttention(reporter: WorkspaceReporter, reportedAt: number): void {
	const queue = new ActivityQueueService();
	const id = sessionSourceId(
		reporter.workspaceId,
		reporter.terminalId,
		reporter.provider,
		reporter.providerSessionId
	);
	const previous = queue.read(id);
	if (!previous || !previous.candidate) return;
	const snapshot = nextAgentEventSnapshot(previous.snapshot, {
		agent: reporter.provider,
		sessionId: reporter.terminalId,
		terminalId: reporter.terminalId,
		providerSessionId: reporter.providerSessionId ?? "",
		workspaceId: reporter.workspaceId,
		alert: "active",
		rawEvent: "WorkspaceContinuation",
		timestamp: reportedAt,
		producerTimestamp: reportedAt,
		cwd: "",
	});
	if (!snapshot) return;
	// The old turn is consumed; delayed hooks from it cannot resurrect attention.
	if (snapshot.turnId)
		snapshot.retiredTurnIds = [...snapshot.retiredTurnIds, snapshot.turnId].slice(-128);
	snapshot.turnId = null;
	queue.observe({
		...previous,
		candidate: null,
		snapshot,
		fingerprint: JSON.stringify(["active", null, null]),
		observedAt: reportedAt,
	});
}

const ownedTypes = ["agent-workspace", "agent-question", "agent-session"];
export const workspaceSourceId = (id: string) => `agent-workspace:${id}`;
export const questionSourceId = (id: string) => `agent-question:${id}`;
export const sessionSourceId = (
	workspaceId: string,
	terminalId: string,
	provider: string,
	providerSessionId: string | null
) => JSON.stringify(["agent-session", workspaceId, terminalId, provider, providerSessionId]);

/** Only explicit terminal identity or a unique known provider session can enter the queue.
 * No cwd, active workspace, or single-terminal-in-workspace inference is used here.
 * Called before the legacy session manager can normalize or persist an event.
 */
export function observeValidatedAgentEvent(
	event: AgentEvent,
	accepted?: (event: AgentEvent, snapshot: AgentEventSnapshot) => void
): boolean {
	const db = getDb();
	if (
		!(AGENT_PROVIDERS as readonly string[]).includes(event.agent) ||
		!Number.isFinite(event.timestamp)
	)
		return false;
	let terminalId = event.terminalId || event.sessionId;
	if (!terminalId && event.providerSessionId) {
		const matches = db
			.select()
			.from(agentSessions)
			.where(
				and(
					eq(agentSessions.provider, event.agent as (typeof AGENT_PROVIDERS)[number]),
					eq(agentSessions.providerSessionId, event.providerSessionId)
				)
			)
			.all();
		if (matches.length !== 1) return false;
		terminalId = matches[0]?.terminalId ?? "";
	}
	if (!terminalId) return false;
	const known = db
		.select()
		.from(agentSessions)
		.where(eq(agentSessions.terminalId, terminalId))
		.get();
	if (known?.lastEventAt && event.timestamp < known.lastEventAt.getTime()) return false;
	const terminal = db
		.select()
		.from(terminalSessions)
		.where(eq(terminalSessions.id, terminalId))
		.get();
	const workspaceId = known?.workspaceId ?? terminal?.workspaceId;
	// An explicit terminal-bound SessionStart may register a previously unseen generation.
	// Previously observed generations cannot reclaim it; bridge invocation time is not evidence.
	const newGeneration = Boolean(
		known &&
			(event.terminalId || event.sessionId) &&
			event.rawEvent === "SessionStart" &&
			["startup", "resume", "clear", "fork"].includes(event.sessionSource ?? "") &&
			event.providerSessionId
	);
	if (
		!workspaceId ||
		(event.workspaceId && workspaceId !== event.workspaceId) ||
		(terminal && terminal.workspaceId !== workspaceId) ||
		(known &&
			!newGeneration &&
			(known.provider !== event.agent ||
				(known.providerSessionId &&
					event.providerSessionId &&
					known.providerSessionId !== event.providerSessionId)))
	)
		return false;
	const workspace = queueEntities().get(workspaceId);
	if (!workspace || (known && known.entityKind !== workspace.entity.kind)) return false;

	const providerSessionId = event.providerSessionId || known?.providerSessionId || null;
	const sourceId = sessionSourceId(workspaceId, terminalId, event.agent, providerSessionId);
	const queue = new ActivityQueueService(db);
	const previous = queue.read(sourceId);
	if (
		newGeneration &&
		known &&
		(known.provider !== event.agent || known.providerSessionId !== providerSessionId) &&
		previous
	)
		return false;
	const transition = transitionAgentEvent(previous?.snapshot, event);
	if (!transition) return false;
	const { snapshot, attention } = transition;
	// Resuming a conversation to view it is navigation, not a reply. Preserve
	// its attention until a prompt or actual tool activity is observed.
	if (
		event.rawEvent === "SessionStart" &&
		event.sessionSource === "resume" &&
		previous?.candidate &&
		known?.provider === event.agent &&
		known.providerSessionId === providerSessionId
	) {
		accepted?.({ ...event, alert: snapshot.alert }, snapshot);
		return true;
	}
	if (
		newGeneration &&
		known &&
		(known.provider !== event.agent || known.providerSessionId !== providerSessionId)
	) {
		const retiredId = sessionSourceId(
			known.workspaceId,
			known.terminalId,
			known.provider,
			known.providerSessionId
		);
		if (queue.read(retiredId)) queue.resolve(retiredId, event.timestamp);
		else
			queue.observe({
				sourceId: retiredId,
				sourceType: "agent-session",
				snapshot: { generationRetired: true },
				fingerprint: "retired-generation",
				candidate: null,
				observedAt: event.timestamp,
			});
	}
	const candidate: ActivityQueueCandidate | null = attention
		? {
				kind: attention.kind,
				title: workspace.name,
				summary: attention.summary,
				projectId: workspace.projectId,
				projectName: workspace.projectName,
				occurredAt: event.timestamp,
				reasons: [attention.reason],
				target: {
					type: "terminal",
					entity: workspace.entity,
					workspaceId,
					terminalId,
					provider: event.agent,
					providerSessionId,
				},
			}
		: null;
	queue.observe({
		sourceId,
		sourceType: "agent-session",
		snapshot,
		fingerprint:
			transition.preserveRevision && previous ? previous.fingerprint : transition.fingerprint,
		candidate,
		observedAt: event.timestamp,
	});
	accepted?.(
		{ ...event, alert: attention?.kind === "agent-input" ? "needs-input" : snapshot.alert },
		snapshot
	);
	return true;
}

/** Reconcile current authoritative state on local list/ack reads (also the restart bootstrap).
 * Questions are selected by unanswered correlation, not by replaying a message journal.
 * Only queue-recorded turn-end evidence can create a ready session: generic idle cannot.
 */
export function reconcileAgentSources(statusChange?: {
	workspaceId: string;
	reportedAt: number;
	reporter?: WorkspaceReporter | null;
}): void {
	const db = getDb();
	const queue = new ActivityQueueService(db);
	const now = Date.now();
	db.transaction(() => {
		const byWorkspace = queueEntities();
		const seen = new Set<string>();
		for (const workspace of byWorkspace.values()) {
			const sourceId = workspaceSourceId(workspace.id);
			seen.add(sourceId);
			const needsInput = workspace.currentPhase === "blocked" || Boolean(workspace.needs?.trim());
			const ready = workspace.currentPhase === "done";
			const label = needsInput ? "Needs input" : "Task complete";
			const previousSnapshot = queue.read(sourceId)?.snapshot as
				| {
						phase?: string;
						needs?: string | null;
						statusText?: string | null;
						reportedAt?: number;
						reporter?: WorkspaceReporter | null;
				  }
				| undefined;
			// The workspace timestamp column is second-precision. Retain the actual
			// report time in the durable snapshot so a delayed prompt cannot clear a
			// newer report in the same second. Read-only reconciliation preserves it.
			const reportedAt =
				statusChange?.workspaceId === workspace.id
					? statusChange.reportedAt
					: previousSnapshot?.phase === workspace.currentPhase &&
							previousSnapshot.needs === workspace.needs &&
							previousSnapshot.statusText === workspace.statusText &&
							typeof previousSnapshot.reportedAt === "number"
						? previousSnapshot.reportedAt
						: (workspace.statusUpdatedAt ?? workspace.updatedAt).getTime();
			const reporter =
				statusChange?.workspaceId === workspace.id
					? (statusChange.reporter ?? null)
					: previousSnapshot?.phase === workspace.currentPhase &&
							previousSnapshot.needs === workspace.needs &&
							previousSnapshot.statusText === workspace.statusText
						? (previousSnapshot.reporter ?? null)
						: null;
			queue.observe({
				sourceId,
				sourceType: "agent-workspace",
				snapshot: {
					version: 1,
					phase: workspace.currentPhase,
					needs: workspace.needs,
					statusText: workspace.statusText,
					reportedAt,
					reporter,
				},
				fingerprint: JSON.stringify([
					workspace.currentPhase,
					workspace.needs,
					workspace.statusText,
					...(reporter ? [reporter] : []),
				]),
				observedAt: now,
				candidate:
					needsInput || ready
						? {
								kind: needsInput ? "agent-input" : "agent-ready",
								title: workspace.name,
								summary: workspace.needs || workspace.statusText || label,
								projectId: workspace.projectId,
								projectName: workspace.projectName,
								occurredAt: (workspace.statusUpdatedAt ?? workspace.updatedAt).getTime(),
								reasons: [{ code: needsInput ? "workspace-blocked" : "task-complete", label }],
								target:
									reporter ??
									(workspace.entity.kind === "coordinator"
										? { type: "coordinator", coordinatorId: workspace.id }
										: { type: "workspace", workspaceId: workspace.id }),
							}
						: null,
			});
		}
		const answers = db.select().from(agentMessages).where(eq(agentMessages.kind, "answer")).all();
		const questions = db
			.select()
			.from(agentMessages)
			.where(eq(agentMessages.kind, "question"))
			.all()
			.filter(
				(question) =>
					!answers.some(
						(answer) =>
							isQuestionAnswer(question, answer) && (!answer.recipient || answer.retrievedAt)
					)
			);
		const projectNames = new Map(
			db
				.select()
				.from(projects)
				.all()
				.map((project) => [project.id, project.name])
		);
		for (const question of questions) {
			const sourceId = questionSourceId(question.id);
			seen.add(sourceId);
			const sender = question.fromWorkspaceId
				? byWorkspace.get(question.fromWorkspaceId)
				: undefined;
			// Deleted workspace senders cannot be navigated to; remove their obsolete work.
			if (!sender) continue;
			queue.observe({
				sourceId,
				sourceType: "agent-question",
				snapshot: { version: 1, messageId: question.id, reporter: question.reporter },
				fingerprint: question.content,
				observedAt: now,
				candidate: {
					kind: "agent-input",
					title: sender.name,
					summary: question.content,
					projectId: question.projectId,
					projectName: projectNames.get(question.projectId),
					occurredAt: question.createdAt.getTime(),
					reasons: [{ code: "unanswered-question", label: "Unanswered question" }],
					target:
						question.reporter ??
						(sender.entity.kind === "coordinator"
							? { type: "coordinator", coordinatorId: sender.id }
							: { type: "workspace", workspaceId: sender.id }),
				},
			});
		}
		const sessions = new Map(
			db
				.select()
				.from(agentSessions)
				.all()
				.map((session) => [session.terminalId, session])
		);
		// A persisted explicit needs-input is authoritative when its terminal binding
		// is still known. Legacy generic idle is deliberately not a turn-end receipt.
		const terminals = new Map(
			db
				.select()
				.from(terminalSessions)
				.all()
				.map((terminal) => [terminal.id, terminal])
		);
		for (const session of sessions.values()) {
			if (
				session.state !== "needs-input" ||
				!session.lastEventAt ||
				(!session.managed && terminals.get(session.terminalId)?.workspaceId !== session.workspaceId)
			)
				continue;
			const id = sessionSourceId(
				session.workspaceId,
				session.terminalId,
				session.provider,
				session.providerSessionId
			);
			if (!queue.read(id))
				observeValidatedAgentEvent({
					terminalId: session.terminalId,
					sessionId: session.terminalId,
					workspaceId: session.workspaceId,
					providerSessionId: session.providerSessionId ?? "",
					agent: session.provider,
					alert: "needs-input",
					timestamp: session.lastEventAt.getTime(),
					cwd: "",
				});
		}
		const sources = db
			.select()
			.from(activityQueueSources)
			.where(inArray(activityQueueSources.sourceType, ownedTypes))
			.all();
		for (const source of sources) {
			if (source.sourceType !== "agent-session") {
				const target = source.candidate?.target;
				if (
					!seen.has(source.sourceId) ||
					(target?.type === "workspace" && !byWorkspace.has(target.workspaceId))
				)
					queue.resolve(source.sourceId, now);
				continue;
			}
			const target = source.candidate?.target;
			if (!target || target.type !== "terminal") continue;
			const session = sessions.get(target.terminalId);
			if (
				!byWorkspace.has(target.workspaceId) ||
				!session ||
				session.workspaceId !== target.workspaceId ||
				session.provider !== target.provider ||
				session.providerSessionId !== target.providerSessionId
			) {
				queue.resolve(source.sourceId, now);
			} else if (session.state === "error") {
				queue.markUnavailable(source.sourceId, session.lastError || "Agent session unavailable");
			} else if (source.error) {
				queue.observe({ ...source, observedAt: now });
			}
		}
	});
}
