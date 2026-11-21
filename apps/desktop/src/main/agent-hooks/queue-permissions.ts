import { randomUUID } from "node:crypto";
import type {
	ActivityQueueTarget,
	WorkspaceQueueItem,
	WorkspaceQueueRevisionInput,
} from "../../shared/activity-queue";
import type {
	QueuePermissionCapability,
	QueuePermissionDecisionInput,
	QueuePermissionDecisionResult,
	QueuePermissionState,
} from "../../shared/queue-permissions";

export type PermissionTarget = Extract<ActivityQueueTarget, { type: "terminal" }>;
export interface PermissionReply {
	requestId: string;
	behavior?: "allow" | "deny";
	receipt?: string;
}
interface WaitingRequest {
	requestId: string;
	issuedAt: number;
	allowOnce: boolean;
	target: PermissionTarget;
	generation: string;
	summary: string;
	alive?: () => boolean;
	quickAlive?: () => boolean;
	reply: (reply: PermissionReply) => boolean;
}
interface Entry extends WaitingRequest {
	state: QueuePermissionState;
	expiresAt: number;
	receipt: string;
	timer: ReturnType<typeof setTimeout>;
	monitor: ReturnType<typeof setInterval>;
}
const identity = (target: ActivityQueueTarget) =>
	target.type === "terminal"
		? JSON.stringify([
				target.entity?.kind,
				target.entity?.id,
				target.workspaceId,
				target.terminalId,
				target.provider,
				target.providerSessionId,
			])
		: "";
const revisions = (value: WorkspaceQueueRevisionInput) =>
	JSON.stringify([
		value.id,
		value.revision,
		(value.members ?? [{ id: value.id, revision: value.revision }])
			.map((m) => [m.id, m.revision])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	]);
const unknownOutcome =
	"Decision sent to the waiting hook. Provider acceptance and action outcome remain unknown.";
const fallback =
	"No active supported permission response channel. Open the conversation to review its native prompt.";

/** Memory-only live capabilities. Restart cannot revive an old request. Never writes a PTY. */
export class QueuePermissions {
	private entries = new Map<string, Entry>();
	private seen = new Map<string, number>();
	private now: () => number;
	constructor(
		private options: {
			currentGeneration: (target: PermissionTarget) => string | null;
			now?: () => number;
			timeoutMs?: number;
		}
	) {
		this.now = options.now ?? Date.now;
	}
	register(request: WaitingRequest): boolean {
		for (const [id, issuedAt] of this.seen)
			if (this.now() - issuedAt > 60_000) this.seen.delete(id);
		for (const [id, entry] of this.entries)
			if (
				entry.state !== "waiting" &&
				entry.state !== "sent" &&
				(this.now() - entry.issuedAt > 60_000 || this.entries.size >= 512)
			) {
				clearTimeout(entry.timer);
				this.entries.delete(id);
			}
		if (
			!Number.isSafeInteger(request.issuedAt) ||
			request.issuedAt > this.now() + 1000 ||
			this.now() - request.issuedAt > 5000
		)
			return false;
		if (
			!/^[0-9a-f-]{36}$/i.test(request.requestId) ||
			this.seen.has(request.requestId) ||
			this.seen.size >= 4096
		)
			return false;
		this.seen.set(request.requestId, request.issuedAt); // Tombstones outlive the strict invocation freshness window.
		if (
			!["claude", "codex"].includes(request.target.provider) ||
			!request.target.providerSessionId ||
			!request.target.entity ||
			this.options.currentGeneration(request.target) !== request.generation
		)
			return false;
		const concurrent = [...this.entries.values()].filter(
			(e) => e.target.terminalId === request.target.terminalId && e.state === "waiting"
		);
		if (concurrent.length) {
			for (const entry of concurrent) this.cancel(entry, "cancelled");
			return false;
		}
		if (this.entries.size >= 512) return false;
		const timeoutMs = Math.min(30_000, this.options.timeoutMs ?? 30_000);
		const entry: Entry = {
			...request,
			summary: request.summary.slice(0, 2048),
			state: "waiting",
			expiresAt: this.now() + timeoutMs,
			receipt: randomUUID(),
			timer: setTimeout(() => this.cancel(entry, "expired"), timeoutMs),
			monitor: setInterval(() => {
				try {
					this.valid(entry);
				} catch {
					this.cancel(entry, "cancelled");
				}
			}, 250),
		};
		entry.timer.unref?.();
		entry.monitor.unref?.();
		this.entries.set(request.requestId, entry);
		return true;
	}
	private valid(entry: Entry, exactProcess = false): boolean {
		if (entry.state !== "waiting") return false;
		const alive = exactProcess ? entry.alive : entry.quickAlive;
		if (alive && !alive()) {
			this.cancel(entry, "cancelled");
			return false;
		}
		if (entry.expiresAt <= this.now()) {
			this.cancel(entry, "expired");
			return false;
		}
		if (this.options.currentGeneration(entry.target) !== entry.generation) {
			this.cancel(entry, "cancelled");
			return false;
		}
		return true;
	}
	capability(item: WorkspaceQueueItem): QueuePermissionCapability {
		const entry = item.permission?.requestId
			? this.entries.get(item.permission.requestId)
			: undefined;
		if (!entry || identity(item.target) !== identity(entry.target))
			return { capability: "unavailable", detail: fallback };
		this.valid(entry);
		return {
			capability: entry.state === "waiting" ? "hook-response" : "unavailable",
			requestId: entry.requestId,
			allowOnce: entry.allowOnce,
			state: entry.state,
			expiresAt: entry.expiresAt,
			summary: entry.summary,
			detail:
				entry.state === "waiting"
					? entry.allowOnce
						? "Allow once or deny this specific request. Open releases this wait to the native prompt."
						: "Full action details are unavailable or redacted. Allow once is unavailable; deny or open the native prompt to review."
					: entry.state === "delivered-to-hook"
						? "The bridge wrote the decision to the provider hook. Provider acceptance and action outcome remain unknown."
						: ["sent", "uncertain"].includes(entry.state)
							? unknownOutcome
							: "This request is no longer waiting. Open the conversation; no decision was made here.",
		};
	}
	decide(
		input: QueuePermissionDecisionInput,
		current: WorkspaceQueueItem | null
	): QueuePermissionDecisionResult {
		const conflict: QueuePermissionDecisionResult = {
			status: "conflict",
			detail:
				"The request, conversation or queue revision changed. Refresh and review the current request.",
		};
		const entry = this.entries.get(input.requestId);
		if (
			!entry ||
			!current ||
			current.stale ||
			current.situation !== "agent-permission" ||
			current.permission?.requestId !== input.requestId ||
			identity(current.target) !== identity(entry.target) ||
			revisions(input) !== revisions(current) ||
			!this.valid(entry, true)
		)
			return conflict;
		if (!["allow-once", "deny", "open"].includes(input.action)) return conflict;
		if (input.action === "allow-once" && !entry.allowOnce)
			return {
				status: "unavailable",
				detail: "Full action details cannot be reviewed here. Open the native prompt.",
			};
		clearInterval(entry.monitor);
		clearTimeout(entry.timer);
		entry.state = input.action === "open" ? "cancelled" : "sent"; // Claim before IO: concurrent/replayed decisions cannot send.
		let sent = false;
		try {
			sent = entry.reply({
				requestId: entry.requestId,
				...(input.action === "open"
					? {}
					: {
							behavior: input.action === "allow-once" ? ("allow" as const) : ("deny" as const),
							receipt: entry.receipt,
						}),
			});
		} catch {
			/* Ambiguous transport failure must never be retried. */
		}
		if (!sent) {
			entry.state = "uncertain";
			return { status: "uncertain", detail: unknownOutcome };
		}
		if (input.action !== "open") {
			entry.timer = setTimeout(() => {
				if (entry.state === "sent") entry.state = "uncertain";
			}, 2000);
			entry.timer.unref?.();
		}
		return {
			status: input.action === "open" ? "opened" : "sent",
			detail:
				input.action === "open"
					? "Released to the provider's native permission flow without deciding."
					: unknownOutcome,
		};
	}
	received(requestId: string, receipt: string): boolean {
		const entry = this.entries.get(requestId);
		if (!entry || entry.state !== "sent" || entry.receipt !== receipt) return false;
		clearTimeout(entry.timer);
		entry.state = "delivered-to-hook";
		return true;
	}
	disconnected(requestId: string) {
		const entry = this.entries.get(requestId);
		if (entry?.state === "waiting") this.cancel(entry, "cancelled");
		else if (entry?.state === "sent") entry.state = "uncertain";
	}
	invalidate(terminalId: string) {
		for (const entry of this.entries.values())
			if (entry.target.terminalId === terminalId && entry.state === "waiting")
				this.cancel(entry, "cancelled");
	}
	private cancel(entry: Entry, state: "expired" | "cancelled") {
		if (entry.state !== "waiting") return;
		entry.state = state;
		clearInterval(entry.monitor);
		clearTimeout(entry.timer);
		try {
			entry.reply({ requestId: entry.requestId });
		} catch {
			/* No permission output on fallback. */
		}
	}
	close() {
		for (const entry of this.entries.values()) {
			this.cancel(entry, "cancelled");
			clearInterval(entry.monitor);
			clearTimeout(entry.timer);
		}
		this.entries.clear();
	}
}
