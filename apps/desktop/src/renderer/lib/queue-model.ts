import type { WorkspaceQueueItem } from "../../shared/activity-queue";

export type WorkspaceQueueFilter = "all" | "input" | "ready";
export function queueCounts(items: readonly WorkspaceQueueItem[]) {
	return {
		all: items.length,
		input: items.filter((i) => i.kind === "agent-input").length,
		ready: items.filter((i) => i.kind === "agent-ready").length,
	};
}
export function orderWorkspaceItems(
	items: readonly WorkspaceQueueItem[],
	filter: WorkspaceQueueFilter,
	group: boolean
): WorkspaceQueueItem[] {
	return items
		.filter(
			(i) => filter === "all" || i.kind === (filter === "input" ? "agent-input" : "agent-ready")
		)
		.slice()
		.sort(
			(a, b) =>
				(group
					? a.context.projectName.localeCompare(b.context.projectName) ||
						(a.context.projectId ?? "").localeCompare(b.context.projectId ?? "")
					: 0) ||
				Number(a.kind !== "agent-input") - Number(b.kind !== "agent-input") ||
				a.occurredAt - b.occurredAt ||
				a.id.localeCompare(b.id)
		);
}
export function nextQueueSelection(
	items: readonly { id: string }[],
	id: string | null,
	previousIndex: number
): string | null {
	if (id && items.some((i) => i.id === id)) return id;
	return items[Math.max(0, Math.min(previousIndex, items.length - 1))]?.id ?? null;
}
export function queueKeysAreTyping(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		!!target.closest(
			"input,textarea,select,[contenteditable=true],[contenteditable=''],.xterm,.xterm-helper-textarea"
		)
	);
}
