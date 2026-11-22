import type { QueueEntity, QueueViewItem } from "../../shared/activity-queue";
import { orderWorkspaceItems } from "./queue-model";

export interface QueueNavigationSession {
	item: QueueViewItem;
	order: string[];
	index: number;
	total: number;
}
export function pendingQueueItems(items: readonly QueueViewItem[]) {
	return orderWorkspaceItems(
		items.filter((item) => !item.snoozed && !item.acknowledged),
		"all",
		false
	);
}
/** Display enrichment is excluded; every source receipt and conversation stays pinned. */
export function queueOccurrenceKey(item: QueueViewItem): string {
	return JSON.stringify([
		item.id,
		item.revision,
		item.category === "agents" ? item.context.entity : null,
		item.target.type === "pr"
			? [
					item.target.provider,
					item.target.host,
					item.target.accountId,
					item.target.owner,
					item.target.repo,
					item.target.number,
				]
			: item.target,
		(item.members ?? [])
			.map(({ id, revision }) => [id, revision])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
	]);
}
export function bindQueueSession(
	item: QueueViewItem,
	items: readonly QueueViewItem[]
): QueueNavigationSession {
	const rows = pendingQueueItems(items);
	return {
		item: structuredClone(item),
		order: rows.map(queueOccurrenceKey),
		index: rows.findIndex((row) => queueOccurrenceKey(row) === queueOccurrenceKey(item)),
		total: rows.length,
	};
}
export function nextPendingItem(
	items: readonly QueueViewItem[],
	session: QueueNavigationSession | null
): QueueViewItem | null {
	const rows = pendingQueueItems(items);
	if (!session) return rows[0] ?? null;
	const current = rows.findIndex(
		(row) => queueOccurrenceKey(row) === queueOccurrenceKey(session.item)
	);
	if (current >= 0) return rows[current + 1] ?? null;
	// A replacement occurrence is reviewable only following this explicit Next gesture.
	const replacement = rows.find((row) => row.id === session.item.id);
	if (replacement) return replacement;
	// Keep the removed row as an ordering anchor. Earlier arrivals never wrap the walk.
	const anchored = orderWorkspaceItems([...rows, session.item], "all", false);
	const anchor = anchored.indexOf(session.item);
	return anchored[anchor + 1] ?? null;
}
export function queueSessionStatus(
	session: QueueNavigationSession,
	items: readonly QueueViewItem[],
	available: boolean
) {
	if (!available) return "unavailable";
	const current = pendingQueueItems(items).find((row) => row.id === session.item.id);
	if (!current) return "cleared";
	if (current.stale) return "unavailable";
	return queueOccurrenceKey(current) === queueOccurrenceKey(session.item) ? "current" : "updated";
}
export interface QueueVisibleDestination {
	entity: QueueEntity;
	pr?: { provider: string; owner: string; repo: string; number: number };
	terminalId?: string | null;
	provider?: string;
	providerSessionId?: string | null;
}
export function matchesQueueDestination(
	item: QueueViewItem,
	visible: QueueVisibleDestination | null
): boolean {
	if (!visible) return false;
	if (item.category === "prs" && item.target.type === "pr")
		return (
			!!visible.pr &&
			visible.pr.provider === item.target.provider &&
			visible.pr.owner === item.target.owner &&
			visible.pr.repo === item.target.repo &&
			visible.pr.number === item.target.number
		);
	if (item.category !== "agents") return false;
	const entity = item.context.entity;
	if (!entity || entity.kind !== visible.entity.kind || entity.id !== visible.entity.id)
		return false;
	const target = item.target;
	if (target.type === "terminal")
		return (
			target.workspaceId === visible.entity.id &&
			target.terminalId === visible.terminalId &&
			target.provider === visible.provider &&
			target.providerSessionId === visible.providerSessionId
		);
	return (
		!visible.terminalId &&
		((target.type === "workspace" &&
			visible.entity.kind === "workspace" &&
			target.workspaceId === visible.entity.id) ||
			(target.type === "coordinator" &&
				visible.entity.kind === "coordinator" &&
				target.coordinatorId === visible.entity.id))
	);
}
