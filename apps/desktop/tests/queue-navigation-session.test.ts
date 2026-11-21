import { expect, test } from "bun:test";
import {
	bindQueueSession,
	matchesQueueDestination,
	nextPendingItem,
	pendingQueueItems,
	queueOccurrenceKey,
	queueSessionStatus,
} from "../src/renderer/lib/queue-navigation-session";
import type { WorkspaceQueueItem } from "../src/shared/activity-queue";

function row(id: string, revision = 1): WorkspaceQueueItem {
	return {
		id,
		revision,
		kind: "agent-input",
		occurredAt: Number(id) || 0,
		acknowledged: false,
		stale: false,
		target: {
			type: "terminal",
			entity: { kind: "workspace", id: "ws" },
			workspaceId: "ws",
			terminalId: id,
			provider: "codex",
			providerSessionId: "conversation",
		},
		context: { entity: { kind: "workspace", id: "ws" }, workspaceId: "ws" },
	} as WorkspaceQueueItem;
}
test("canonical pending excludes Later and acknowledged rows", () => {
	expect(
		pendingQueueItems([
			row("3"),
			{ ...row("1"), snoozed: { until: null, untilChange: true } },
			row("2"),
			{ ...row("4"), acknowledged: true },
		]).map((i) => i.id)
	).toEqual(["2", "3"]);
});
test("next stops at end and does not skip shifted successor after current resolves", () => {
	const rows = [row("1"), row("2"), row("3")];
	const session = bindQueueSession(rows[1]!, rows);
	expect(nextPendingItem(rows, null)?.id).toBe("1");
	expect(nextPendingItem(rows, session)?.id).toBe("3");
	expect(nextPendingItem([rows[0]!, rows[2]!], session)?.id).toBe("3");
	expect(nextPendingItem(rows, bindQueueSession(rows[2]!, rows))).toBeNull();
	expect(nextPendingItem([rows[0]!], session)).toBeNull();
	expect(nextPendingItem([row("1", 2)], session)).toBeNull();
	expect(nextPendingItem([row("2.5"), rows[2]!], session)?.id).toBe("2.5");
});
test("new occurrence and grouped receipt change require explicit selection", () => {
	const item = { ...row("1"), members: [{ id: "report", revision: 2 }] };
	const session = bindQueueSession(item, [item]);
	expect(queueSessionStatus(session, [item], true)).toBe("current");
	expect(
		queueSessionStatus(session, [{ ...item, members: [{ id: "report", revision: 3 }] }], true)
	).toBe("updated");
	expect(queueSessionStatus(session, [], true)).toBe("cleared");
	expect(queueSessionStatus(session, [], false)).toBe("unavailable");
	expect(queueSessionStatus(session, [{ ...item, stale: true }], true)).toBe("unavailable");
	expect(nextPendingItem([row("1", 2)], session)?.revision).toBe(2);
	expect(session.item.revision).toBe(1);
});
test("destination matches exact entity chat provider and conversation", () => {
	const item = row("1");
	const visible = {
		entity: { kind: "workspace" as const, id: "ws" },
		terminalId: "1",
		provider: "codex",
		providerSessionId: "conversation",
	};
	expect(matchesQueueDestination(item, visible)).toBe(true);
	for (const change of [
		{ terminalId: "sibling" },
		{ provider: "claude" },
		{ providerSessionId: "replacement" },
		{ entity: { kind: "coordinator" as const, id: "ws" } },
	])
		expect(matchesQueueDestination(item, { ...visible, ...change })).toBe(false);
	expect(queueOccurrenceKey(item)).not.toBe(
		queueOccurrenceKey({
			...item,
			target: { ...item.target, providerSessionId: "replacement" } as WorkspaceQueueItem["target"],
		})
	);
});
