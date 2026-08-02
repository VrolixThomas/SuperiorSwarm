import "./preload-electron-mock";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { makeTestDb } from "./test-db";

// Route getDb() through a per-test in-memory DB so upsertTeamMembers operates in isolation.
const state: { db: ReturnType<typeof makeTestDb> } = { db: makeTestDb() };

mock.module("../src/main/db", () => ({
	getDb: () => state.db,
	schema: require("../src/main/db/schema"),
}));

const {
	getCachedTeamMembers,
	getDefaultTicketNavigation,
	getPlanningData,
	getVisibleTeamsTyped,
	replaceProviderPlanning,
	setVisibleTeamsTyped,
	setDefaultTicketNavigation,
	upsertTeamMembers,
} = await import("../src/main/tickets/cache");
const { teamMembers } = await import("../src/main/db/schema");

function seed(
	provider: "linear" | "jira",
	teamId: string,
	rows: Array<{ userId: string; name: string; email?: string | null; avatarUrl?: string | null }>
): void {
	const now = new Date();
	for (const r of rows) {
		state.db
			.insert(teamMembers)
			.values({
				id: `${provider}:${teamId}:${r.userId}`,
				provider,
				userId: r.userId,
				name: r.name,
				email: r.email ?? null,
				avatarUrl: r.avatarUrl ?? null,
				teamId,
				updatedAt: now,
			})
			.run();
	}
}

describe("upsertTeamMembers", () => {
	beforeEach(() => {
		state.db = makeTestDb();
	});

	test("inserts new members when team has none", () => {
		upsertTeamMembers("linear", "team-1", [
			{ userId: "u1", name: "Alice", email: "a@x", avatarUrl: null },
			{ userId: "u2", name: "Bob", email: null, avatarUrl: "b.png" },
		]);

		const rows = getCachedTeamMembers({ provider: "linear", teamId: "team-1" });
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.userId).sort()).toEqual(["u1", "u2"]);
	});

	test("updates changed fields and leaves unchanged rows alone", () => {
		seed("linear", "team-1", [
			{ userId: "u1", name: "Alice", email: "a@x", avatarUrl: null },
			{ userId: "u2", name: "Bob", email: null, avatarUrl: null },
		]);

		upsertTeamMembers("linear", "team-1", [
			{ userId: "u1", name: "Alice Renamed", email: "a@x", avatarUrl: null },
			{ userId: "u2", name: "Bob", email: null, avatarUrl: null },
		]);

		const rows = getCachedTeamMembers({ provider: "linear", teamId: "team-1" });
		const u1 = rows.find((r) => r.userId === "u1");
		expect(u1?.name).toBe("Alice Renamed");
	});

	test("deletes rows no longer in the incoming set", () => {
		seed("linear", "team-1", [
			{ userId: "u1", name: "Alice" },
			{ userId: "u2", name: "Bob" },
			{ userId: "u3", name: "Carol" },
		]);

		upsertTeamMembers("linear", "team-1", [
			{ userId: "u1", name: "Alice", email: null, avatarUrl: null },
		]);

		const rows = getCachedTeamMembers({ provider: "linear", teamId: "team-1" });
		expect(rows.map((r) => r.userId)).toEqual(["u1"]);
	});

	test("empty incoming list deletes all rows for the team", () => {
		seed("linear", "team-1", [{ userId: "u1", name: "Alice" }]);

		upsertTeamMembers("linear", "team-1", []);

		expect(getCachedTeamMembers({ provider: "linear", teamId: "team-1" })).toHaveLength(0);
	});

	test("isolates writes by provider/teamId — does not touch other teams", () => {
		seed("linear", "team-1", [{ userId: "u1", name: "Alice" }]);
		seed("linear", "team-2", [{ userId: "u2", name: "Bob" }]);
		seed("jira", "PROJ", [{ userId: "acc-1", name: "Dana" }]);

		upsertTeamMembers("linear", "team-1", []);

		expect(getCachedTeamMembers({ provider: "linear", teamId: "team-1" })).toHaveLength(0);
		expect(getCachedTeamMembers({ provider: "linear", teamId: "team-2" })).toHaveLength(1);
		expect(getCachedTeamMembers({ provider: "jira", teamId: "PROJ" })).toHaveLength(1);
	});

	test("no-op when incoming matches existing exactly", () => {
		seed("linear", "team-1", [{ userId: "u1", name: "Alice", email: "a@x", avatarUrl: "a.png" }]);
		const before = getCachedTeamMembers({ provider: "linear", teamId: "team-1" })[0];

		upsertTeamMembers("linear", "team-1", [
			{ userId: "u1", name: "Alice", email: "a@x", avatarUrl: "a.png" },
		]);

		const after = getCachedTeamMembers({ provider: "linear", teamId: "team-1" })[0];
		// updatedAt should not have been bumped since row was identical
		expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
	});
});

describe("planning metadata cache", () => {
	beforeEach(() => {
		state.db = makeTestDb();
	});

	test("replaces one provider without dropping the other provider", () => {
		replaceProviderPlanning(
			"linear",
			[
				{
					id: "team-1",
					provider: "linear",
					groupId: "team-1",
					name: "Engineering",
					kind: "team",
					supportsIterations: true,
					selected: true,
				},
			],
			[]
		);
		replaceProviderPlanning(
			"jira",
			[
				{
					id: "board-1",
					provider: "jira",
					groupId: "PROJ",
					name: "Scrum board",
					kind: "board",
					supportsIterations: true,
					selected: true,
				},
			],
			[
				{
					id: "sprint-1",
					provider: "jira",
					contextId: "board-1",
					groupId: "PROJ",
					name: "Sprint 1",
					state: "active",
					startAt: null,
					endAt: null,
				},
			]
		);

		const planning = getPlanningData();
		expect(planning.contexts.map((context) => context.provider).sort()).toEqual(["jira", "linear"]);
		expect(planning.iterations).toHaveLength(1);
	});
});

describe("visible team preferences", () => {
	beforeEach(() => {
		state.db = makeTestDb();
	});

	test("distinguishes no visible teams from the default all-teams preference", () => {
		setVisibleTeamsTyped([]);
		expect(getVisibleTeamsTyped()).toEqual([]);

		setVisibleTeamsTyped(null);
		expect(getVisibleTeamsTyped()).toBeNull();
	});
});

describe("default ticket navigation", () => {
	beforeEach(() => {
		state.db = makeTestDb();
	});

	test("persists an exact Jira board as the startup default", () => {
		setDefaultTicketNavigation({
			kind: "group",
			provider: "jira",
			groupId: "PROJ",
			contextId: "board-42",
		});

		expect(getDefaultTicketNavigation()).toEqual({
			kind: "group",
			provider: "jira",
			groupId: "PROJ",
			contextId: "board-42",
		});
	});

	test("supports All tickets as the startup default", () => {
		setDefaultTicketNavigation({ kind: "all" });
		expect(getDefaultTicketNavigation()).toEqual({ kind: "all" });
	});
});
