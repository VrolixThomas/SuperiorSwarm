/** Complete provider feedback snapshots only. Unknown pages never mean resolved. */
export interface PRFeedbackEvent {
	id: string;
	authorId: string;
	author: string;
	body: string;
	at: number;
	resolved?: boolean;
	filePath?: string;
	lineNumber?: number | null;
	threadId?: string;
	side?: "LEFT" | "RIGHT" | null;
}
export interface PRFeedbackSnapshot {
	version: 1;
	seen: string[];
	resolved?: string[];
	pending: PRFeedbackEvent[];
}
export function classifyPRFeedback(
	previous: PRFeedbackSnapshot | undefined,
	events: PRFeedbackEvent[],
	viewerId: string,
	handled: boolean
) {
	const relevant = events.filter((e) => e.authorId !== viewerId && e.body.trim() && !e.resolved);
	const seen = new Set(previous?.seen ?? events.map((e) => e.id));
	const previouslyResolved = new Set(previous?.resolved ?? []);
	const added = previous
		? relevant.filter((e) => !seen.has(e.id) || previouslyResolved.has(e.id))
		: [];
	const oldPendingIds = new Set(handled ? [] : (previous?.pending.map((e) => e.id) ?? []));
	// Refresh text in place without inventing a new event on an ordinary edit.
	const pending = [...relevant.filter((e) => oldPendingIds.has(e.id)), ...added];
	return {
		version: 1 as const,
		seen: [...new Set([...seen, ...events.map((e) => e.id)])],
		resolved: events.filter((e) => e.resolved).map((e) => e.id),
		pending: [...new Map(pending.map((e) => [e.id, e])).values()],
	};
}
