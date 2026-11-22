import { expect, test } from "bun:test";
import {
	nextQueueSelection,
	orderWorkspaceItems,
	queueCounts,
} from "../src/renderer/lib/queue-model";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";
function row(id: string, kind: "agent-input" | "agent-ready", time: number, project = "Alpha") {
	return {
		id,
		kind,
		occurredAt: time,
		context: { projectName: project, projectId: project },
	} as WorkspaceQueueItem;
}
test("workspace queue prioritizes input then oldest; grouping preserves that order", () => {
	const rows = [
		row("ready", "agent-ready", 0),
		row("late", "agent-input", 2),
		row("early", "agent-input", 1, "Beta"),
	];
	expect(orderWorkspaceItems(rows, "all", false).map((i) => i.id)).toEqual([
		"early",
		"late",
		"ready",
	]);
	expect(orderWorkspaceItems(rows, "all", true).map((i) => i.id)).toEqual([
		"late",
		"ready",
		"early",
	]);
	expect(orderWorkspaceItems(rows, "ready", false).map((i) => i.id)).toEqual(["ready"]);
	expect(queueCounts(rows)).toEqual({ all: 3, input: 2, ready: 1, prs: 0, tickets: 0, hooks: 0 });
});
test("selection survives refresh and picks the same position after removal", () => {
	const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
	expect(nextQueueSelection(rows, "b", 0)).toBe("b");
	expect(
		nextQueueSelection(
			rows.filter((i) => i.id !== "b"),
			"b",
			1
		)
	).toBe("c");
	expect(nextQueueSelection([{ id: "a" }], "c", 2)).toBe("a");
	expect(nextQueueSelection([], "a", 0)).toBeNull();
});
