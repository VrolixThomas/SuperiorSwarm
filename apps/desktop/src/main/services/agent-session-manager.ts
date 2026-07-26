import { and, desc, eq, ne } from "drizzle-orm";
import type { AgentEvent } from "../../shared/agent-events";
import {
	AGENT_PROVIDERS,
	type AgentProvider,
	type AgentSessionInfo,
	type AgentSessionState,
	type AgentSessionStatusEvent,
	type AgentSleepSettings,
} from "../../shared/agent-session";
import { getDb } from "../db";
import { agentSessions, terminalSessions, workspaces } from "../db/schema";
import type { DaemonClient } from "../terminal/daemon-client";
import type {
	AgentForegroundInspection,
	AgentProcessController,
	AgentTerminationResult,
} from "./agent-process-controller";
import { getAgentSleepSettings } from "./agent-sleep-settings";

const DEFAULT_MINUTE_MS = 60_000;

export interface RegisterManagedAgentInput {
	terminalId: string;
	workspaceId: string;
	provider: AgentProvider;
	providerSessionId: string | null;
	skipPermissions: boolean;
}

interface AgentSessionManagerOptions {
	daemonClient: DaemonClient;
	processController: AgentProcessController;
	onStatus?: (event: AgentSessionStatusEvent) => void;
	getSettings?: () => AgentSleepSettings;
	minuteMs?: number;
}

export type WorkspaceWakeResult =
	| { status: "woke"; terminalId: string }
	| { status: "none" }
	| { status: "ambiguous"; terminalIds: string[] }
	| { status: "failed"; terminalId: string; error: string };

function isAgentProvider(value: string): value is AgentProvider {
	return (AGENT_PROVIDERS as readonly string[]).includes(value);
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildAgentResumeCommand(
	session: Pick<AgentSessionInfo, "provider" | "providerSessionId" | "skipPermissions">,
	prompt?: string
): string {
	if (!session.providerSessionId) throw new Error("Agent session has no provider session ID");
	const id = shellQuote(session.providerSessionId);
	const message = prompt ? ` ${shellQuote(prompt)}` : "";

	switch (session.provider) {
		case "claude":
			return `claude --resume ${id}${session.skipPermissions ? " --dangerously-skip-permissions" : ""}${message}`;
		case "codex":
			return `codex resume ${id}${session.skipPermissions ? " -c approval_policy=never -c sandbox_mode=danger-full-access" : ""}${message}`;
		case "gemini":
			return `gemini --resume ${id}${session.skipPermissions ? " --yolo" : ""}${message}`;
		case "opencode":
			return `opencode --session ${id}${prompt ? ` --prompt ${shellQuote(prompt)}` : ""}`;
	}
}

function rowToInfo(row: typeof agentSessions.$inferSelect): AgentSessionInfo {
	return {
		terminalId: row.terminalId,
		workspaceId: row.workspaceId,
		provider: row.provider,
		providerSessionId: row.providerSessionId,
		state: row.state,
		managed: row.managed,
		keepRunning: row.keepRunning,
		skipPermissions: row.skipPermissions,
		lastEventAt: row.lastEventAt,
		idleSince: row.idleSince,
		hibernatedAt: row.hibernatedAt,
		lastError: row.lastError,
	};
}

export class AgentSessionManager {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly visibleTerminals = new Set<string>();
	private readonly transitions = new Set<string>();
	private readonly getSettings: () => AgentSleepSettings;
	private readonly minuteMs: number;
	private disposed = false;

	constructor(private readonly options: AgentSessionManagerOptions) {
		this.getSettings = options.getSettings ?? getAgentSleepSettings;
		this.minuteMs = options.minuteMs ?? DEFAULT_MINUTE_MS;
	}

	registerManagedSession(input: RegisterManagedAgentInput): AgentSessionInfo {
		const db = getDb();
		const now = new Date();
		db.transaction((tx) => {
			// `managed` identifies the one dispatch target that orchestrator
			// follow-ups may wake. Older app-owned terminals remain tracked but
			// are deliberately demoted so workspace wakeups never rely on recency.
			tx.update(agentSessions)
				.set({ managed: false, updatedAt: now })
				.where(
					and(
						eq(agentSessions.workspaceId, input.workspaceId),
						eq(agentSessions.managed, true),
						ne(agentSessions.terminalId, input.terminalId)
					)
				)
				.run();
			tx.insert(agentSessions)
				.values({
					terminalId: input.terminalId,
					workspaceId: input.workspaceId,
					provider: input.provider,
					providerSessionId: input.providerSessionId,
					state: "running",
					managed: true,
					keepRunning: false,
					skipPermissions: input.skipPermissions,
					lastEventAt: now,
					idleSince: null,
					hibernatedAt: null,
					lastError: null,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: agentSessions.terminalId,
					set: {
						workspaceId: input.workspaceId,
						provider: input.provider,
						providerSessionId: input.providerSessionId,
						state: "running",
						managed: true,
						skipPermissions: input.skipPermissions,
						lastEventAt: now,
						idleSince: null,
						hibernatedAt: null,
						lastError: null,
						updatedAt: now,
					},
				})
				.run();
		});
		const session = this.getSession(input.terminalId);
		if (!session) throw new Error("Failed to persist managed agent session");
		this.emit(session);
		return session;
	}

	handleAgentEvent(event: AgentEvent): AgentEvent {
		if (!isAgentProvider(event.agent)) return event;
		const resolved = this.resolveEventTarget(event, event.agent);
		if (!resolved) return event;

		const existing = this.getSession(resolved.terminalId);
		const now = new Date(event.timestamp);
		let state: AgentSessionState;
		switch (event.alert) {
			case "active":
				state = "running";
				break;
			case "needs-input":
				state = "needs-input";
				break;
			case "task-complete":
				state = existing?.state === "hibernating" ? "hibernating" : "idle";
				break;
		}

		const providerSessionId =
			event.providerSessionId || existing?.providerSessionId || resolved.providerSessionId || null;
		const db = getDb();
		db.insert(agentSessions)
			.values({
				terminalId: resolved.terminalId,
				workspaceId: resolved.workspaceId,
				provider: event.agent,
				providerSessionId,
				state,
				managed: existing?.managed ?? false,
				keepRunning: existing?.keepRunning ?? false,
				skipPermissions: existing?.skipPermissions ?? false,
				lastEventAt: now,
				idleSince: state === "idle" ? now : null,
				hibernatedAt: existing?.hibernatedAt ?? null,
				lastError: null,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: agentSessions.terminalId,
				set: {
					workspaceId: resolved.workspaceId,
					provider: event.agent,
					providerSessionId,
					state,
					lastEventAt: now,
					idleSince: state === "idle" ? now : null,
					lastError: null,
					updatedAt: now,
				},
			})
			.run();

		const session = this.getSession(resolved.terminalId);
		if (session) {
			if (state === "idle") this.scheduleIfEligible(session);
			else this.cancelTimer(session.terminalId);
			this.emit(session);
		}

		return {
			...event,
			sessionId: resolved.terminalId,
			terminalId: resolved.terminalId,
			providerSessionId: providerSessionId ?? "",
			workspaceId: resolved.workspaceId,
		};
	}

	listSessions(): AgentSessionInfo[] {
		return getDb()
			.select()
			.from(agentSessions)
			.orderBy(desc(agentSessions.updatedAt))
			.all()
			.map(rowToInfo);
	}

	getSession(terminalId: string): AgentSessionInfo | null {
		const row = getDb()
			.select()
			.from(agentSessions)
			.where(eq(agentSessions.terminalId, terminalId))
			.get();
		return row ? rowToInfo(row) : null;
	}

	async setVisible(terminalId: string, visible: boolean): Promise<void> {
		if (this.disposed) return;
		if (visible) {
			this.visibleTerminals.add(terminalId);
			this.cancelTimer(terminalId);
			await this.waitForTransition(terminalId);
			await this.wake(terminalId);
			return;
		}
		this.visibleTerminals.delete(terminalId);
		const session = this.getSession(terminalId);
		if (session?.state === "idle") this.scheduleIfEligible(session);
	}

	async beforeTerminalInput(terminalId: string): Promise<void> {
		if (this.disposed) return;
		this.cancelTimer(terminalId);
		await this.waitForTransition(terminalId);
		const session = this.getSession(terminalId);
		if (!session) return;
		if (session.state === "hibernated") {
			await this.wake(terminalId);
			return;
		}
		if (session.state === "idle" || session.state === "needs-input") {
			this.updateState(terminalId, "running", { idleSince: null, lastError: null });
		}
	}

	setKeepRunning(terminalId: string, keepRunning: boolean): AgentSessionInfo | null {
		const now = new Date();
		getDb()
			.update(agentSessions)
			.set({ keepRunning, updatedAt: now })
			.where(eq(agentSessions.terminalId, terminalId))
			.run();
		if (keepRunning) this.cancelTimer(terminalId);
		const session = this.getSession(terminalId);
		if (session && !keepRunning && session.state === "idle") this.scheduleIfEligible(session);
		if (session) this.emit(session);
		return session;
	}

	async sleepNow(terminalId: string): Promise<AgentSessionInfo> {
		const session = await this.sleep(terminalId, false);
		if (!session) throw new Error(`Unknown agent terminal: ${terminalId}`);
		return session;
	}

	async wake(terminalId: string, prompt?: string): Promise<AgentSessionInfo | null> {
		let session = this.getSession(terminalId);
		if (this.transitions.has(terminalId)) {
			await this.waitForTransition(terminalId);
			session = this.getSession(terminalId);
		}
		if (!session || session.state !== "hibernated") return session;
		if (!this.options.daemonClient.isConnected) return session;
		this.transitions.add(terminalId);
		this.cancelTimer(terminalId);

		try {
			const daemonSession = (await this.options.daemonClient.listSessions()).find(
				(candidate) => candidate.id === terminalId
			);
			if (!daemonSession) {
				return this.updateState(terminalId, "error", {
					lastError: "Terminal shell is no longer available",
				});
			}
			const command = buildAgentResumeCommand(session, prompt);
			this.updateState(terminalId, "resuming", { lastError: null });
			this.options.daemonClient.write(terminalId, `${command}\r`);
			return this.updateState(terminalId, "running", {
				idleSince: null,
				hibernatedAt: null,
				lastError: null,
			});
		} catch (error) {
			return this.updateState(terminalId, "error", {
				lastError: error instanceof Error ? error.message : "Failed to resume agent",
			});
		} finally {
			this.transitions.delete(terminalId);
		}
	}

	async wakeWorkspace(workspaceId: string, prompt: string): Promise<WorkspaceWakeResult> {
		const targets = getDb()
			.select()
			.from(agentSessions)
			.where(and(eq(agentSessions.workspaceId, workspaceId), eq(agentSessions.managed, true)))
			.orderBy(desc(agentSessions.updatedAt))
			.all();
		if (targets.length === 0) return { status: "none" };
		if (targets.length > 1) {
			return {
				status: "ambiguous",
				terminalIds: targets.map((target) => target.terminalId),
			};
		}

		const target = targets[0];
		if (!target || target.state !== "hibernated") return { status: "none" };
		const result = await this.wake(target.terminalId, prompt);
		if (result?.state === "running") {
			return { status: "woke", terminalId: target.terminalId };
		}
		return {
			status: "failed",
			terminalId: target.terminalId,
			error: result?.lastError ?? "Agent did not enter the running state",
		};
	}

	removeSession(terminalId: string): void {
		this.cancelTimer(terminalId);
		this.visibleTerminals.delete(terminalId);
		this.transitions.delete(terminalId);
		getDb().delete(agentSessions).where(eq(agentSessions.terminalId, terminalId)).run();
	}

	removeWorkspaceSessions(workspaceId: string): void {
		const terminalIds = getDb()
			.select({ terminalId: agentSessions.terminalId })
			.from(agentSessions)
			.where(eq(agentSessions.workspaceId, workspaceId))
			.all()
			.map((row) => row.terminalId);
		for (const terminalId of terminalIds) {
			this.cancelTimer(terminalId);
			this.visibleTerminals.delete(terminalId);
			this.transitions.delete(terminalId);
		}
		getDb().delete(agentSessions).where(eq(agentSessions.workspaceId, workspaceId)).run();
	}

	applySettings(): void {
		if (this.disposed) return;
		for (const terminalId of this.timers.keys()) this.cancelTimer(terminalId);
		if (!this.getSettings().enabled) return;
		for (const session of this.listSessions()) {
			if (session.state === "idle") this.scheduleIfEligible(session);
		}
	}

	async reconcile(): Promise<void> {
		if (this.disposed) return;
		for (const session of this.listSessions()) {
			if (
				session.state !== "hibernating" &&
				session.state !== "resuming" &&
				session.state !== "hibernated"
			)
				continue;
			const inspection = await this.options.processController.inspectForeground(
				session.terminalId,
				session.provider
			);
			if (this.disposed) return;
			this.reconcileSession(session, inspection);
		}
		this.applySettings();
		for (const terminalId of this.visibleTerminals) {
			if (this.getSession(terminalId)?.state === "hibernated") {
				void this.wake(terminalId);
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		for (const terminalId of this.timers.keys()) this.cancelTimer(terminalId);
		this.transitions.clear();
		this.visibleTerminals.clear();
	}

	private resolveEventTarget(
		event: AgentEvent,
		provider: AgentProvider
	): { terminalId: string; workspaceId: string; providerSessionId: string | null } | null {
		let terminalId = event.terminalId || event.sessionId;
		let workspaceId = event.workspaceId;

		if (!terminalId && event.providerSessionId) {
			const known = getDb()
				.select()
				.from(agentSessions)
				.where(
					and(
						eq(agentSessions.provider, provider),
						eq(agentSessions.providerSessionId, event.providerSessionId)
					)
				)
				.get();
			if (known) {
				terminalId = known.terminalId;
				workspaceId ||= known.workspaceId;
			}
		}

		if (!terminalId && workspaceId) {
			const candidates = getDb()
				.select()
				.from(agentSessions)
				.where(
					and(eq(agentSessions.workspaceId, workspaceId), eq(agentSessions.provider, provider))
				)
				.orderBy(desc(agentSessions.updatedAt))
				.all();
			if (candidates.length === 1) {
				terminalId = candidates[0]?.terminalId ?? "";
			}
		}

		if (!terminalId && event.cwd) {
			const terminals = getDb()
				.select()
				.from(terminalSessions)
				.where(eq(terminalSessions.cwd, event.cwd))
				.orderBy(desc(terminalSessions.updatedAt))
				.all();
			const candidates = terminals.filter((terminal) => {
				const known = this.getSession(terminal.id);
				return !known || known.provider === provider;
			});
			if (candidates.length === 1) {
				terminalId = candidates[0]?.id ?? "";
				workspaceId ||= candidates[0]?.workspaceId ?? "";
			}
		}

		if (terminalId && !workspaceId) {
			const terminal = getDb()
				.select({ workspaceId: terminalSessions.workspaceId })
				.from(terminalSessions)
				.where(eq(terminalSessions.id, terminalId))
				.get();
			workspaceId = terminal?.workspaceId ?? "";
		}

		if (!terminalId || !workspaceId) return null;
		return {
			terminalId,
			workspaceId,
			providerSessionId: event.providerSessionId || null,
		};
	}

	private scheduleIfEligible(session: AgentSessionInfo): void {
		this.cancelTimer(session.terminalId);
		const settings = this.getSettings();
		if (
			!settings.enabled ||
			session.state !== "idle" ||
			!session.providerSessionId ||
			session.keepRunning ||
			this.visibleTerminals.has(session.terminalId)
		) {
			return;
		}
		if (settings.keepOrchestratorsAwake) {
			const workspace = getDb()
				.select({ isOrchestrator: workspaces.isOrchestrator })
				.from(workspaces)
				.where(eq(workspaces.id, session.workspaceId))
				.get();
			if (workspace?.isOrchestrator) return;
		}

		const idleElapsed = session.idleSince
			? Math.max(0, Date.now() - session.idleSince.getTime())
			: 0;
		const delay = Math.max(0, settings.idleMinutes * this.minuteMs - idleElapsed);
		const timer = setTimeout(() => {
			this.timers.delete(session.terminalId);
			void this.sleep(session.terminalId, true).catch((error) => {
				console.warn(`[agent-session] automatic sleep failed for ${session.terminalId}:`, error);
			});
		}, delay);
		this.timers.set(session.terminalId, timer);
	}

	private async sleep(terminalId: string, automatic: boolean): Promise<AgentSessionInfo | null> {
		const session = this.getSession(terminalId);
		if (!session) {
			if (automatic) return null;
			throw new Error(`Unknown agent terminal: ${terminalId}`);
		}
		if (session.state === "hibernated") return session;
		if (this.transitions.has(terminalId)) return session;

		if (automatic) {
			const settings = this.getSettings();
			if (
				!settings.enabled ||
				session.state !== "idle" ||
				session.keepRunning ||
				this.visibleTerminals.has(terminalId)
			) {
				return session;
			}
			if (settings.keepOrchestratorsAwake) {
				const workspace = getDb()
					.select({ isOrchestrator: workspaces.isOrchestrator })
					.from(workspaces)
					.where(eq(workspaces.id, session.workspaceId))
					.get();
				if (workspace?.isOrchestrator) return session;
			}
		}

		if (!session.providerSessionId) {
			throw new Error("Cannot sleep an agent before its provider session ID is known");
		}

		this.transitions.add(terminalId);
		this.cancelTimer(terminalId);
		try {
			this.updateState(terminalId, "hibernating", { lastError: null });
			let result: AgentTerminationResult;
			try {
				result = await this.options.processController.terminateForeground(
					terminalId,
					session.provider
				);
			} catch (error) {
				result = {
					ok: false,
					error: error instanceof Error ? error.message : "Failed to terminate agent",
				};
			}
			if (this.disposed) return session;
			if (!result.ok) {
				const state: AgentSessionState = automatic ? "idle" : "error";
				return (
					this.updateState(terminalId, state, {
						lastError: result.error ?? "Agent sleep was cancelled",
					}) ?? session
				);
			}
			return (
				this.updateState(terminalId, "hibernated", {
					hibernatedAt: new Date(),
					idleSince: null,
					lastError: null,
				}) ?? session
			);
		} finally {
			this.transitions.delete(terminalId);
		}
	}

	private updateState(
		terminalId: string,
		state: AgentSessionState,
		fields: {
			idleSince?: Date | null;
			hibernatedAt?: Date | null;
			lastError?: string | null;
		} = {}
	): AgentSessionInfo | null {
		getDb()
			.update(agentSessions)
			.set({ state, ...fields, updatedAt: new Date() })
			.where(eq(agentSessions.terminalId, terminalId))
			.run();
		const session = this.getSession(terminalId);
		if (session) this.emit(session);
		return session;
	}

	private reconcileSession(session: AgentSessionInfo, inspection: AgentForegroundInspection): void {
		let nextState: AgentSessionState;
		let lastError: string | null = null;

		switch (inspection.status) {
			case "agent":
				nextState = "running";
				break;
			case "shell":
				nextState = "hibernated";
				break;
			case "missing":
				nextState = "error";
				lastError = "Terminal shell is no longer available";
				break;
			case "other":
				nextState = "error";
				lastError = "Terminal has an unexpected foreground process";
				break;
			case "unknown":
				// A stable sleeping session remains recoverable when a transient
				// process inspection fails. Interrupted transitions fail closed.
				if (session.state === "hibernated") return;
				nextState = "error";
				lastError = inspection.error;
				break;
		}

		getDb()
			.update(agentSessions)
			.set({
				state: nextState,
				idleSince: nextState === "running" ? null : session.idleSince,
				hibernatedAt: nextState === "hibernated" ? (session.hibernatedAt ?? new Date()) : null,
				lastError,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(agentSessions.terminalId, session.terminalId),
					eq(agentSessions.state, session.state)
				)
			)
			.run();
		const current = this.getSession(session.terminalId);
		if (current && current.state === nextState) this.emit(current);
	}

	private cancelTimer(terminalId: string): void {
		const timer = this.timers.get(terminalId);
		if (timer) clearTimeout(timer);
		this.timers.delete(terminalId);
	}

	private async waitForTransition(terminalId: string): Promise<void> {
		const deadline = Date.now() + 5_000;
		while (this.transitions.has(terminalId) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}

	private emit(session: AgentSessionInfo): void {
		this.options.onStatus?.({
			terminalId: session.terminalId,
			state: session.state,
			provider: session.provider,
			keepRunning: session.keepRunning,
			lastError: session.lastError,
		});
	}
}
