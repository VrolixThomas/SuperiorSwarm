import type { ActivityQueueItem, ActivityQueueKind } from "../../shared/activity-queue";

export const QUEUE_GROUPS: { kind: ActivityQueueKind; label: string }[] = [
	{ kind: "agent-input", label: "Needs input" },
	{ kind: "pr-review", label: "PR review needed" },
	{ kind: "pr-update", label: "PR updated" },
	{ kind: "agent-ready", label: "Ready agents" },
];

/** Keep the greatest revision if a refresh overlaps. A PR's reasons stay on its one row. */
export function uniqueQueueItems(items: readonly ActivityQueueItem[]): ActivityQueueItem[] {
	const byId = new Map<string, ActivityQueueItem>();
	for (const item of items) {
		const previous = byId.get(item.id);
		if (!previous || item.revision > previous.revision) byId.set(item.id, item);
	}
	return [...byId.values()].sort(
		(a, b) =>
			QUEUE_GROUPS.findIndex((g) => g.kind === a.kind) -
				QUEUE_GROUPS.findIndex((g) => g.kind === b.kind) ||
			b.occurredAt - a.occurredAt ||
			(a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
	);
}

export function queueAge(occurredAt: number, now = Date.now()): string {
	const minutes = Math.floor(Math.max(0, now - occurredAt) / 60_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function queueLocation(item: ActivityQueueItem): string {
	const project = item.projectName ?? item.projectId;
	const target = item.target;
	const location =
		target.type === "pr"
			? `${target.owner}/${target.repo} #${target.number}`
			: target.type === "terminal"
				? `Workspace ${target.workspaceId} · Terminal ${target.terminalId}`
				: target.type === "workspace"
					? `Workspace ${target.workspaceId}`
					: target.type === "hermes"
						? `Profile ${target.profileId} · Session ${target.sessionId}`
						: "Destination unavailable";
	return project ? `${project} · ${location}` : location;
}
