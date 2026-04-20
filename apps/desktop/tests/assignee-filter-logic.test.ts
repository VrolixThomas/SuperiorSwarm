import { describe, expect, test } from "bun:test";
import {
	UNASSIGNED_FILTER_KEY,
	computeNextAssigneeFilter,
	deserializeAssigneeFilter,
} from "../src/shared/tickets";

describe("computeNextAssigneeFilter — user toggle", () => {
	const me = ["me-linear", "me-jira"];

	test("from 'all' toggling a user → only that user selected", () => {
		expect(computeNextAssigneeFilter("all", "u1", me)).toEqual({
			userIds: ["u1"],
			includeUnassigned: false,
		});
	});

	test("from 'me' clicking self → collapses back to 'all'", () => {
		expect(computeNextAssigneeFilter("me", "me-linear", me)).toBe("all");
	});

	test("from 'me' clicking another user → shows only them", () => {
		expect(computeNextAssigneeFilter("me", "u1", me)).toEqual({
			userIds: ["u1"],
			includeUnassigned: false,
		});
	});

	test("object mode — adds user not in list", () => {
		const current = { userIds: ["u1"], includeUnassigned: false };
		expect(computeNextAssigneeFilter(current, "u2", me)).toEqual({
			userIds: ["u1", "u2"],
			includeUnassigned: false,
		});
	});

	test("object mode — removes user in list", () => {
		const current = { userIds: ["u1", "u2"], includeUnassigned: false };
		expect(computeNextAssigneeFilter(current, "u1", me)).toEqual({
			userIds: ["u2"],
			includeUnassigned: false,
		});
	});

	test("object mode — removing last user with no unassigned collapses to 'all'", () => {
		const current = { userIds: ["u1"], includeUnassigned: false };
		expect(computeNextAssigneeFilter(current, "u1", me)).toBe("all");
	});

	test("object mode — removing last user when unassigned is still checked stays in object mode", () => {
		const current = { userIds: ["u1"], includeUnassigned: true };
		expect(computeNextAssigneeFilter(current, "u1", me)).toEqual({
			userIds: [],
			includeUnassigned: true,
		});
	});
});

describe("computeNextAssigneeFilter — unassigned toggle", () => {
	const me = ["me-linear"];

	test("from 'all' → object mode with only unassigned", () => {
		expect(computeNextAssigneeFilter("all", UNASSIGNED_FILTER_KEY, me)).toEqual({
			userIds: [],
			includeUnassigned: true,
		});
	});

	test("from 'me' → object mode with me + unassigned", () => {
		expect(computeNextAssigneeFilter("me", UNASSIGNED_FILTER_KEY, me)).toEqual({
			userIds: ["me-linear"],
			includeUnassigned: true,
		});
	});

	test("object mode — turns unassigned off", () => {
		const current = { userIds: ["u1"], includeUnassigned: true };
		expect(computeNextAssigneeFilter(current, UNASSIGNED_FILTER_KEY, me)).toEqual({
			userIds: ["u1"],
			includeUnassigned: false,
		});
	});

	test("object mode — turning off unassigned when no users collapses to 'all'", () => {
		const current = { userIds: [], includeUnassigned: true };
		expect(computeNextAssigneeFilter(current, UNASSIGNED_FILTER_KEY, me)).toBe("all");
	});

	test("object mode — turns unassigned on", () => {
		const current = { userIds: ["u1"], includeUnassigned: false };
		expect(computeNextAssigneeFilter(current, UNASSIGNED_FILTER_KEY, me)).toEqual({
			userIds: ["u1"],
			includeUnassigned: true,
		});
	});
});

describe("deserializeAssigneeFilter", () => {
	test("null → 'me'", () => {
		expect(deserializeAssigneeFilter(null)).toBe("me");
	});

	test("empty string → 'me'", () => {
		expect(deserializeAssigneeFilter("")).toBe("me");
	});

	test("'me' → 'me'", () => {
		expect(deserializeAssigneeFilter("me")).toBe("me");
	});

	test("'all' → 'all'", () => {
		expect(deserializeAssigneeFilter("all")).toBe("all");
	});

	test("valid object JSON parses through", () => {
		const json = JSON.stringify({ userIds: ["u1"], includeUnassigned: true });
		expect(deserializeAssigneeFilter(json)).toEqual({ userIds: ["u1"], includeUnassigned: true });
	});

	test("malformed JSON → falls back to 'me'", () => {
		expect(deserializeAssigneeFilter("{not json")).toBe("me");
	});

	test("JSON with wrong shape (missing userIds) → falls back to 'me'", () => {
		expect(deserializeAssigneeFilter(JSON.stringify({ includeUnassigned: true }))).toBe("me");
	});

	test("JSON with wrong shape (userIds not array) → falls back to 'me'", () => {
		expect(
			deserializeAssigneeFilter(JSON.stringify({ userIds: "u1", includeUnassigned: true }))
		).toBe("me");
	});

	test("JSON with wrong shape (includeUnassigned not bool) → falls back to 'me'", () => {
		expect(
			deserializeAssigneeFilter(JSON.stringify({ userIds: ["u1"], includeUnassigned: "yes" }))
		).toBe("me");
	});
});
