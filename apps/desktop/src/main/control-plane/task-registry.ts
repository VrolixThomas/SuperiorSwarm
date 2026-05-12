export type TaskMode = "workspace-agent" | "review" | "solve" | "quick-action-setup" | "none";

export interface TaskRegistration {
	mode: TaskMode;
	projectId: string;
	workspaceId: string;
	modeContext: Record<string, string | undefined>;
}

interface Entry extends TaskRegistration {
	expiresAt: number;
}

interface Opts {
	ttlMs?: number;
	now?: () => number;
}

export class TaskRegistry {
	private readonly store = new Map<string, Entry>();
	private readonly ttlMs: number;
	private readonly now: () => number;

	constructor(opts: Opts = {}) {
		this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
		this.now = opts.now ?? Date.now;
	}

	register(token: string, reg: TaskRegistration): void {
		this.store.set(token, { ...reg, expiresAt: this.now() + this.ttlMs });
	}

	consume(token: string): TaskRegistration | null {
		const entry = this.store.get(token);
		if (!entry) return null;
		this.store.delete(token);
		if (entry.expiresAt < this.now()) return null;
		const { expiresAt: _, ...rest } = entry;
		return rest;
	}
}
