import { randomUUID } from "node:crypto";
import type { QueueEntity } from "../../shared/activity-queue";
import type { WorkspaceReporter } from "./agent-source";

export const QUEUE_ADMISSION_TTL_MS = 30_000;
const MAX_PENDING_ADMISSIONS = 512;
type Lease = {
	entity: QueueEntity;
	terminalId: string;
	provider?: string;
	expiresAt: number;
	first: WorkspaceReporter | null;
	rejected: boolean;
};
const identity = (owner: WorkspaceReporter) =>
	JSON.stringify([
		owner.entity?.kind ?? "workspace",
		owner.workspaceId,
		owner.terminalId,
		owner.provider,
		owner.providerSessionId,
	]);

/** First registration, not current/most-recent lookup. A replacement permanently invalidates the lease. */
export class ReporterAdmissions {
	private readonly leases = new Map<string, Lease>();
	private readonly waiters = new Map<string, Set<() => void>>();
	issue(entity: QueueEntity, terminalId: string, provider?: string, now = Date.now()) {
		this.prune(now);
		if (this.leases.size >= MAX_PENDING_ADMISSIONS) {
			const oldest = this.leases.keys().next().value;
			if (oldest) {
				this.leases.delete(oldest);
				this.notify(oldest);
			}
		}
		const token = randomUUID();
		const expiresAt = now + QUEUE_ADMISSION_TTL_MS;
		this.leases.set(token, {
			entity,
			terminalId,
			provider,
			expiresAt,
			first: null,
			rejected: false,
		});
		return { token, expiresAt };
	}
	record(owner: WorkspaceReporter, now = Date.now()) {
		this.prune(now);
		if (!owner.providerSessionId) return;
		for (const lease of this.leases.values()) {
			if (lease.terminalId !== owner.terminalId) continue;
			if (
				lease.entity.id !== owner.workspaceId ||
				lease.entity.kind !== (owner.entity?.kind ?? "workspace") ||
				(lease.provider && lease.provider !== owner.provider)
			) {
				lease.rejected = true;
				continue;
			}
			if (lease.first && identity(lease.first) !== identity(owner)) lease.rejected = true;
			else if (!lease.rejected) lease.first = { ...owner };
		}
		for (const [token, lease] of this.leases)
			if (lease.terminalId === owner.terminalId) this.notify(token);
	}

	invalidate(terminalId: string) {
		for (const [token, lease] of this.leases)
			if (lease.terminalId === terminalId) {
				lease.rejected = true;
				this.notify(token);
			}
	}
	async wait(
		token: string,
		entityId: string,
		terminalId: string,
		current: () => WorkspaceReporter | null,
		timeoutMs = 5000
	) {
		const initial = this.resolve(token, entityId, terminalId, current());
		if (initial.status !== "pending") return initial;
		await new Promise<void>((resolve) => {
			let finished = false;
			const finish = () => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				this.waiters.get(token)?.delete(changed);
				if (!this.waiters.get(token)?.size) this.waiters.delete(token);
				resolve();
			};
			const changed = () => {
				if (this.resolve(token, entityId, terminalId, current()).status !== "pending") finish();
			};
			const timer = setTimeout(finish, timeoutMs);
			const callbacks = this.waiters.get(token) ?? new Set();
			callbacks.add(changed);
			this.waiters.set(token, callbacks);
			changed();
		});
		// Revalidate after the first event: a replacement before response cannot borrow its lease.
		return this.resolve(token, entityId, terminalId, current());
	}
	private notify(token: string) {
		for (const callback of this.waiters.get(token) ?? []) callback();
	}

	resolve(
		token: string,
		entityId: string,
		terminalId: string,
		current: WorkspaceReporter | null,
		now = Date.now()
	):
		| { status: "pending" }
		| { status: "admitted"; reporter: WorkspaceReporter }
		| { status: "rejected"; message: string } {
		this.prune(now);
		const lease = this.leases.get(token);
		const rejected = {
			status: "rejected" as const,
			message:
				"First conversation admission expired or changed. Restart MCP in the intended conversation.",
		};
		if (!lease || lease.rejected || lease.entity.id !== entityId || lease.terminalId !== terminalId)
			return rejected;
		if (!lease.first) {
			if (current) {
				lease.rejected = true;
				return rejected;
			} // Unobserved/out-of-band registration is not proof.
			return { status: "pending" };
		}
		if (!current || identity(current) !== identity(lease.first)) {
			lease.rejected = true;
			return rejected;
		}
		return { status: "admitted", reporter: lease.first };
	}
	private prune(now: number) {
		for (const [token, lease] of this.leases)
			if (lease.expiresAt <= now) {
				this.leases.delete(token);
				this.notify(token);
			}
	}
}
export const reporterAdmissions = new ReporterAdmissions();
