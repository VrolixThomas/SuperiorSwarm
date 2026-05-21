import type { AgentMessageDto, WorkspacePhase } from "../../shared/control-plane";

export interface StatusEvent {
	event: "status";
	workspaceId: string;
	phase: WorkspacePhase;
	statusText: string | null;
	needs: string | null;
	ts: string;
}

export interface MessageEvent {
	event: "message";
	messageId: string;
	from: string;
	to: string | null;
	kind: AgentMessageDto["kind"];
	content: string;
	ts: string;
}

export type CoordinationEvent = StatusEvent | MessageEvent;

type Subscriber = (ev: CoordinationEvent) => void;
type WildcardSubscriber = (projectId: string, ev: CoordinationEvent) => void;

export class EventBus {
	private subs = new Map<string, Set<Subscriber>>();
	private wildcard = new Set<WildcardSubscriber>();

	subscribe(projectId: string, fn: Subscriber): () => void {
		let set = this.subs.get(projectId);
		if (!set) {
			set = new Set();
			this.subs.set(projectId, set);
		}
		set.add(fn);
		return () => {
			set?.delete(fn);
			if (set && set.size === 0) this.subs.delete(projectId);
		};
	}

	subscribeAll(fn: WildcardSubscriber): () => void {
		this.wildcard.add(fn);
		return () => {
			this.wildcard.delete(fn);
		};
	}

	emit(projectId: string, ev: CoordinationEvent): void {
		const set = this.subs.get(projectId);
		if (set) {
			for (const fn of set) {
				try {
					fn(ev);
				} catch {
					// best-effort: ignore subscriber failures
				}
			}
		}
		for (const fn of this.wildcard) {
			try {
				fn(projectId, ev);
			} catch {
				// best-effort: ignore subscriber failures
			}
		}
	}
}
