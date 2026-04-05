import { describe, expect, test } from "bun:test";
import { normalizeStatusCategory } from "../src/shared/tickets";

describe("TicketsTableView status sort", () => {
	test("normalizeStatusCategory uses statusCategory, not status.name for Jira", () => {
		// status.name "In Progress" does NOT match any case — falls to default "todo"
		expect(normalizeStatusCategory("jira", "In Progress")).toBe("todo");

		// statusCategory "indeterminate" correctly maps to "in_progress"
		expect(normalizeStatusCategory("jira", "indeterminate")).toBe("in_progress");
	});

	test("Jira sort order uses statusCategory field", () => {
		const issues = [
			{ provider: "jira" as const, statusCategory: "done", stateType: undefined },
			{ provider: "jira" as const, statusCategory: "indeterminate", stateType: undefined },
			{ provider: "jira" as const, statusCategory: "new", stateType: undefined },
		];

		const STATUS_RANK = { in_progress: 0, todo: 1, backlog: 2, done: 3 };
		const sorted = [...issues].sort((a, b) => {
			const catA = normalizeStatusCategory(a.provider, a.statusCategory, a.stateType);
			const catB = normalizeStatusCategory(b.provider, b.statusCategory, b.stateType);
			return STATUS_RANK[catA] - STATUS_RANK[catB];
		});

		expect(sorted[0].statusCategory).toBe("indeterminate"); // in_progress = 0
		expect(sorted[1].statusCategory).toBe("new"); // todo = 1
		expect(sorted[2].statusCategory).toBe("done"); // done = 3
	});
});
