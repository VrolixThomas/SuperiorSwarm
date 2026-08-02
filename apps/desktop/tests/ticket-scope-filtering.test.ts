import { describe, expect, test } from "bun:test";
import type { MergedTicketIssue } from "../src/shared/tickets";
import {
	isTicketNavigationTarget,
	matchesTicketPlanningContext,
	matchesTicketScope,
	ticketNavigationTargetsEqual,
} from "../src/shared/tickets";

function issue(overrides: Partial<MergedTicketIssue> = {}): MergedTicketIssue {
	return {
		provider: "jira",
		id: "PI-1",
		identifier: "PI-1",
		title: "Ticket",
		url: "https://example.com/PI-1",
		status: { id: "todo", name: "Todo", color: "#000" },
		groupId: "PI",
		statusCategory: "new",
		...overrides,
	};
}

describe("matchesTicketScope", () => {
	test("separates current sprint tickets from the backlog", () => {
		const current = issue({
			planning: { contextId: "board-1", iterationIds: ["sprint-1"], bucket: "active" },
		});
		const backlog = issue({
			id: "PI-2",
			planning: { contextId: "board-1", iterationIds: [], bucket: "backlog" },
		});

		expect(matchesTicketScope(current, { kind: "current" })).toBe(true);
		expect(matchesTicketScope(current, { kind: "backlog" })).toBe(false);
		expect(matchesTicketScope(backlog, { kind: "current" })).toBe(false);
		expect(matchesTicketScope(backlog, { kind: "backlog" })).toBe(true);
	});

	test("all open excludes completed tickets", () => {
		expect(matchesTicketScope(issue(), { kind: "all_open" })).toBe(true);
		expect(matchesTicketScope(issue({ statusCategory: "done" }), { kind: "all_open" })).toBe(false);
	});

	test("historical iteration scope matches provider and iteration membership", () => {
		const historical = issue({
			statusCategory: "done",
			planning: { contextId: "board-1", iterationIds: ["sprint-9"], bucket: "closed" },
		});
		expect(
			matchesTicketScope(historical, {
				kind: "iteration",
				provider: "jira",
				iterationId: "sprint-9",
			})
		).toBe(true);
		expect(
			matchesTicketScope(historical, {
				kind: "iteration",
				provider: "linear",
				iterationId: "sprint-9",
			})
		).toBe(false);
	});

	test("non-iterative projects fall back to all open for current and backlog", () => {
		const open = issue();
		expect(matchesTicketScope(open, { kind: "current" }, false)).toBe(true);
		expect(matchesTicketScope(open, { kind: "backlog" }, false)).toBe(true);
	});

	test("non-iterative boards still separate current work from their backlog", () => {
		const current = issue({
			planning: { contextId: "kanban-1", iterationIds: [], bucket: "active" },
		});
		const backlog = issue({
			id: "PI-2",
			planning: { contextId: "kanban-1", iterationIds: [], bucket: "backlog" },
		});
		expect(matchesTicketScope(current, { kind: "current" }, false)).toBe(true);
		expect(matchesTicketScope(current, { kind: "backlog" }, false)).toBe(false);
		expect(matchesTicketScope(backlog, { kind: "current" }, false)).toBe(false);
		expect(matchesTicketScope(backlog, { kind: "backlog" }, false)).toBe(true);
	});
});

describe("matchesTicketPlanningContext", () => {
	test("keeps the project cache complete but limits a selected Jira board", () => {
		const context = {
			id: "board-1",
			provider: "jira" as const,
			groupId: "PROJ",
			name: "Delivery",
			kind: "board" as const,
			supportsIterations: true,
			selected: true,
		};

		expect(
			matchesTicketPlanningContext(
				issue({ planning: { contextId: "board-1", iterationIds: [], bucket: "backlog" } }),
				context
			)
		).toBeTrue();
		expect(matchesTicketPlanningContext(issue(), context)).toBeFalse();
	});

	test("does not narrow the stable snapshot when Agile planning is unavailable", () => {
		expect(
			matchesTicketPlanningContext(issue(), {
				id: "jira-project:PROJ",
				provider: "jira",
				groupId: "PROJ",
				name: "PROJ",
				kind: "board",
				supportsIterations: false,
				selected: true,
			})
		).toBeTrue();
	});
});

describe("ticket navigation targets", () => {
	test("distinguishes boards within the same Jira project", () => {
		const first = {
			kind: "group",
			provider: "jira",
			groupId: "PROJ",
			contextId: "board-1",
		} as const;
		const second = {
			kind: "group",
			provider: "jira",
			groupId: "PROJ",
			contextId: "board-2",
		} as const;
		expect(ticketNavigationTargetsEqual(first, { ...first })).toBe(true);
		expect(ticketNavigationTargetsEqual(first, second)).toBe(false);
	});

	test("treats a Linear team's legacy context id as the same navigation target", () => {
		expect(
			ticketNavigationTargetsEqual(
				{ kind: "group", provider: "linear", groupId: "team-1" },
				{
					kind: "group",
					provider: "linear",
					groupId: "team-1",
					contextId: "team-1",
				}
			)
		).toBe(true);
	});

	test("validates persisted navigation targets", () => {
		expect(isTicketNavigationTarget({ kind: "all" })).toBe(true);
		expect(
			isTicketNavigationTarget({
				kind: "group",
				provider: "linear",
				groupId: "team-1",
			})
		).toBe(true);
		expect(isTicketNavigationTarget({ kind: "group", provider: "jira" })).toBe(false);
	});
});
