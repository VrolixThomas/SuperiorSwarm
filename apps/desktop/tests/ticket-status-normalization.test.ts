import { describe, expect, test } from "bun:test";
import { normalizeStatusCategory } from "../src/shared/tickets";

describe("normalizeStatusCategory", () => {
	describe("jira", () => {
		test("maps 'new' to 'todo'", () => {
			expect(normalizeStatusCategory("jira", "new")).toBe("todo");
		});

		test("maps 'indeterminate' to 'in_progress'", () => {
			expect(normalizeStatusCategory("jira", "indeterminate")).toBe("in_progress");
		});

		test("maps 'done' to 'done'", () => {
			expect(normalizeStatusCategory("jira", "done")).toBe("done");
		});

		test("maps unknown category to 'todo'", () => {
			expect(normalizeStatusCategory("jira", "something_else")).toBe("todo");
		});

		test("maps undefined category to 'todo'", () => {
			expect(normalizeStatusCategory("jira", undefined)).toBe("todo");
		});
	});

	describe("linear", () => {
		test("maps 'triage' to 'backlog'", () => {
			expect(normalizeStatusCategory("linear", undefined, "triage")).toBe("backlog");
		});

		test("maps 'backlog' to 'backlog'", () => {
			expect(normalizeStatusCategory("linear", undefined, "backlog")).toBe("backlog");
		});

		test("maps 'unstarted' to 'todo'", () => {
			expect(normalizeStatusCategory("linear", undefined, "unstarted")).toBe("todo");
		});

		test("maps 'started' to 'in_progress'", () => {
			expect(normalizeStatusCategory("linear", undefined, "started")).toBe("in_progress");
		});

		test("maps 'completed' to 'done'", () => {
			expect(normalizeStatusCategory("linear", undefined, "completed")).toBe("done");
		});

		test("maps 'cancelled' to 'done'", () => {
			expect(normalizeStatusCategory("linear", undefined, "cancelled")).toBe("done");
		});

		test("maps undefined stateType to 'todo'", () => {
			expect(normalizeStatusCategory("linear", undefined, undefined)).toBe("todo");
		});
	});
});
