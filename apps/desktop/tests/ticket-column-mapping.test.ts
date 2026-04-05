import { describe, expect, test } from "bun:test";
import { columnToJiraCategory, columnToLinearStateType } from "../src/shared/tickets";

describe("columnToJiraCategory", () => {
	test("maps todo to 'new'", () => {
		expect(columnToJiraCategory("todo")).toBe("new");
	});

	test("maps in_progress to 'indeterminate'", () => {
		expect(columnToJiraCategory("in_progress")).toBe("indeterminate");
	});

	test("maps done to 'done'", () => {
		expect(columnToJiraCategory("done")).toBe("done");
	});

	test("maps backlog to 'new'", () => {
		expect(columnToJiraCategory("backlog")).toBe("new");
	});
});

describe("columnToLinearStateType", () => {
	test("maps backlog to 'backlog'", () => {
		expect(columnToLinearStateType("backlog")).toBe("backlog");
	});

	test("maps todo to 'unstarted'", () => {
		expect(columnToLinearStateType("todo")).toBe("unstarted");
	});

	test("maps in_progress to 'started'", () => {
		expect(columnToLinearStateType("in_progress")).toBe("started");
	});

	test("maps done to 'completed'", () => {
		expect(columnToLinearStateType("done")).toBe("completed");
	});
});
