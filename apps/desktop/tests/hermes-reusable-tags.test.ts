import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type Database from "better-sqlite3";
import { _setDbForTesting, getDb, schema } from "../src/main/db";
import {
	HERMES_TAG_COLORS,
	HermesTagConflictError,
	addHermesSessionTag,
	assignHermesSessionTag,
	backfillLegacyHermesSessionTags,
	createHermesTagDefinition,
	deleteHermesTagDefinition,
	getHermesSessionMetadata,
	listHermesTagDefinitions,
	normalizeHermesTagKey,
	setHermesSessionTags,
	unassignHermesSessionTag,
	updateHermesTagDefinition,
} from "../src/main/hermes/hermes-session-metadata";
import { makeTestDb } from "./test-db";

const scope = {
	managerId: "manager-a",
	connectionId: "connection-a",
	profileId: "work",
};
const sessionIdentity = { ...scope, durableSessionId: "session-a" };

function seedManagerAndConnection(managerId: string, connectionId: string): void {
	const now = new Date("2026-08-11T00:00:00.000Z");
	getDb()
		.insert(schema.crossRepoOrchestrators)
		.values({
			id: managerId,
			name: managerId,
			workDir: `/managers/${managerId}`,
			agentKind: "external",
			status: "idle",
			sortOrder: 0,
			kind: "external",
			tokenHash: managerId.padEnd(64, "0").slice(0, 64),
			accessScope: "all",
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.run();
	getDb()
		.insert(schema.hermesConnections)
		.values({
			id: connectionId,
			label: connectionId,
			baseUrl: `https://${connectionId}.example.test`,
			profileId: "work",
			managerId,
			managerBindingMode: "manual",
			createdAt: now,
			updatedAt: now,
		})
		.run();
}

describe("Hermes reusable tag definitions", () => {
	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		seedManagerAndConnection("manager-a", "connection-a");
		seedManagerAndConnection("manager-a", "connection-b");
		seedManagerAndConnection("manager-b", "connection-c");
	});

	afterEach(() => _setDbForTesting(null));

	test("uses a fixed palette and normalized uniqueness within the complete scope", () => {
		expect(HERMES_TAG_COLORS).toEqual([
			"gray",
			"blue",
			"cyan",
			"green",
			"amber",
			"orange",
			"red",
			"pink",
			"purple",
		]);
		expect(normalizeHermesTagKey("  Needs Follow-Up  ")).toBe("needs follow-up");

		const created = createHermesTagDefinition({
			...scope,
			name: " Needs Follow-Up ",
			color: "amber",
		});
		expect(created).toMatchObject({
			name: "Needs Follow-Up",
			normalizedKey: "needs follow-up",
			color: "amber",
			revision: 0,
		});
		expect(created.id).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
		expect(() =>
			createHermesTagDefinition({ ...scope, name: "needs follow-up", color: "blue" })
		).toThrow(HermesTagConflictError);
		expect(() =>
			createHermesTagDefinition({ ...scope, name: "another", color: "chartreuse" as "blue" })
		).toThrow("Tag color is invalid");
		expect(() =>
			createHermesTagDefinition({ ...scope, name: "ﬃ".repeat(100), color: "blue" })
		).toThrow("Tag must be 100 characters or fewer");
	});

	test("isolates equal names across manager, connection, and profile and supports scoped search", () => {
		const scopes = [
			scope,
			{ ...scope, connectionId: "connection-b" },
			{ managerId: "manager-b", connectionId: "connection-c", profileId: "work" },
			{ ...scope, profileId: "personal" },
		] as const;
		for (const [index, tagScope] of scopes.entries()) {
			createHermesTagDefinition({
				...tagScope,
				name: "Shared",
				color: HERMES_TAG_COLORS[index] ?? "gray",
			});
			createHermesTagDefinition({ ...tagScope, name: `Only ${index}`, color: "gray" });
		}

		for (const tagScope of scopes) {
			expect(listHermesTagDefinitions(tagScope, "sha")).toEqual([
				expect.objectContaining({ name: "Shared" }),
			]);
		}
		expect(getDb().select().from(schema.hermesTagDefinitions).all()).toHaveLength(8);
	});

	test("renames and recolors with optimistic revisions instead of last-write-wins", () => {
		const created = createHermesTagDefinition({ ...scope, name: "Waiting", color: "gray" });
		assignHermesSessionTag({ ...sessionIdentity, definitionId: created.id });
		expect(getDb().select().from(schema.hermesSessionMetadata).get()?.legacyTagsJson).toBe(
			'["Waiting"]'
		);
		const renamed = updateHermesTagDefinition({
			...scope,
			definitionId: created.id,
			name: "Blocked",
			color: "red",
			expectedRevision: 0,
		});
		expect(renamed).toMatchObject({ name: "Blocked", color: "red", revision: 1 });
		expect(() =>
			updateHermesTagDefinition({
				...scope,
				definitionId: created.id,
				name: "Stale",
				expectedRevision: 0,
			})
		).toThrow(HermesTagConflictError);
		expect(listHermesTagDefinitions(scope)).toEqual([
			expect.objectContaining({ name: "Blocked", color: "red", revision: 1 }),
		]);
		expect(getDb().select().from(schema.hermesSessionMetadata).get()?.legacyTagsJson).toBe(
			'["Blocked"]'
		);
	});

	test("binds definitions once, preserves assignment order, and caps sessions at 64", () => {
		const first = createHermesTagDefinition({ ...scope, name: "First", color: "blue" });
		const second = createHermesTagDefinition({ ...scope, name: "Second", color: "green" });
		expect(assignHermesSessionTag({ ...sessionIdentity, definitionId: second.id })).toMatchObject({
			revision: 1,
			tags: [expect.objectContaining({ id: second.id, name: "Second", color: "green" })],
		});
		expect(assignHermesSessionTag({ ...sessionIdentity, definitionId: second.id })).toMatchObject({
			revision: 1,
		});
		expect(assignHermesSessionTag({ ...sessionIdentity, definitionId: first.id })).toMatchObject({
			revision: 2,
			tags: [expect.objectContaining({ id: second.id }), expect.objectContaining({ id: first.id })],
		});

		for (let index = 2; index < 64; index++) {
			const definition = createHermesTagDefinition({
				...scope,
				name: `Tag ${index}`,
				color: "gray",
			});
			assignHermesSessionTag({ ...sessionIdentity, definitionId: definition.id });
		}
		const overflow = createHermesTagDefinition({ ...scope, name: "Overflow", color: "orange" });
		expect(() => assignHermesSessionTag({ ...sessionIdentity, definitionId: overflow.id })).toThrow(
			"Sessions can have at most 64 tags"
		);
		expect(getHermesSessionMetadata(sessionIdentity).tags).toHaveLength(64);

		expect(unassignHermesSessionTag({ ...sessionIdentity, definitionId: second.id })).toMatchObject(
			{
				revision: 65,
			}
		);
		expect(unassignHermesSessionTag({ ...sessionIdentity, definitionId: second.id })).toMatchObject(
			{
				revision: 65,
			}
		);
	});

	test("rejects cross-scope assignment and atomically detaches on revision-checked delete", () => {
		const definition = createHermesTagDefinition({ ...scope, name: "Scoped", color: "purple" });
		assignHermesSessionTag({ ...sessionIdentity, definitionId: definition.id });
		expect(() =>
			assignHermesSessionTag({
				...sessionIdentity,
				connectionId: "connection-b",
				definitionId: definition.id,
			})
		).toThrow("Tag definition was not found");
		expect(() =>
			deleteHermesTagDefinition({ ...scope, definitionId: definition.id, expectedRevision: 1 })
		).toThrow(HermesTagConflictError);

		const raw = (getDb() as unknown as { $client: Database.Database }).$client;
		raw.exec(`
			CREATE TRIGGER prevent_scoped_tag_delete
			BEFORE DELETE ON hermes_tag_definitions
			BEGIN SELECT RAISE(ABORT, 'simulated delete failure'); END;
		`);
		expect(() =>
			deleteHermesTagDefinition({ ...scope, definitionId: definition.id, expectedRevision: 0 })
		).toThrow("simulated delete failure");
		expect(getHermesSessionMetadata(sessionIdentity).tags).toHaveLength(1);
		raw.exec("DROP TRIGGER prevent_scoped_tag_delete");

		expect(
			deleteHermesTagDefinition({ ...scope, definitionId: definition.id, expectedRevision: 0 })
		).toEqual({ detachedSessionCount: 1 });
		expect(getHermesSessionMetadata(sessionIdentity).tags).toEqual([]);
	});

	test("backfills legacy JSON without loss, normalized duplicates, or scope leakage", () => {
		const now = new Date("2026-08-11T01:00:00.000Z");
		getDb()
			.insert(schema.hermesSessionMetadata)
			.values([
				{
					...sessionIdentity,
					customTitle: "Durable title",
					legacyTagsJson: '[" Urgent ","urgent","Customer","URGENT"]',
					revision: 4,
					createdAt: now,
					updatedAt: now,
				},
				{
					...sessionIdentity,
					connectionId: "connection-b",
					legacyTagsJson: '["Urgent","Other"]',
					revision: 2,
					createdAt: now,
					updatedAt: now,
				},
				{
					...sessionIdentity,
					profileId: "personal",
					durableSessionId: "partially-malformed",
					legacyTagsJson: JSON.stringify(["Safe", 7, "x".repeat(101), "Another"]),
					revision: 0,
					createdAt: now,
					updatedAt: now,
				},
			])
			.run();

		expect(backfillLegacyHermesSessionTags()).toEqual({
			definitionsCreated: 6,
			assignmentsCreated: 6,
		});
		expect(backfillLegacyHermesSessionTags()).toEqual({
			definitionsCreated: 0,
			assignmentsCreated: 0,
		});
		expect(getHermesSessionMetadata(sessionIdentity)).toMatchObject({
			customTitle: "Durable title",
			revision: 4,
			tags: [
				expect.objectContaining({ name: "Urgent", color: "gray" }),
				expect.objectContaining({ name: "Customer", color: "gray" }),
			],
		});
		expect(
			getHermesSessionMetadata({ ...sessionIdentity, connectionId: "connection-b" }).tags.map(
				(tag) => tag.name
			)
		).toEqual(["Urgent", "Other"]);
		expect(
			getHermesSessionMetadata({
				...sessionIdentity,
				profileId: "personal",
				durableSessionId: "partially-malformed",
			}).tags.map((tag) => tag.name)
		).toEqual(["Safe", "Another"]);

		const urgent = getHermesSessionMetadata(sessionIdentity).tags[0];
		if (!urgent) throw new Error("Missing backfilled tag");
		unassignHermesSessionTag({ ...sessionIdentity, definitionId: urgent.id });
		expect(getDb().select().from(schema.hermesSessionMetadata).all()[0]?.legacyTagsJson).toBe(
			'["Customer"]'
		);
		expect(backfillLegacyHermesSessionTags()).toEqual({
			definitionsCreated: 0,
			assignmentsCreated: 0,
		});
		expect(getHermesSessionMetadata(sessionIdentity).tags.map((tag) => tag.name)).toEqual([
			"Customer",
		]);
	});

	test("keeps legacy name-based writes compatible by translating through definitions", () => {
		const state = setHermesSessionTags({
			...sessionIdentity,
			tags: [" Ready ", "ready", "Customer"],
			expectedRevision: 0,
		});
		expect(state).toMatchObject({
			revision: 1,
			tags: [
				expect.objectContaining({ name: "Ready", color: "gray" }),
				expect.objectContaining({ name: "Customer", color: "gray" }),
			],
		});
		expect(listHermesTagDefinitions(scope).map((tag) => tag.name)).toEqual(["Customer", "Ready"]);
		expect(
			getDb()
				.select()
				.from(schema.hermesSessionTagAssignments)
				.all()
				.map((row) => row.position)
		).toEqual([0, 1]);
	});

	test("rolls back legacy add when the assignment cannot be committed", () => {
		for (let index = 0; index < 64; index++) {
			const definition = createHermesTagDefinition({
				...scope,
				name: `Assigned ${index}`,
				color: "gray",
			});
			assignHermesSessionTag({ ...sessionIdentity, definitionId: definition.id });
		}

		expect(() => addHermesSessionTag({ ...sessionIdentity, tag: "Must roll back" })).toThrow(
			"Sessions can have at most 64 tags"
		);
		expect(listHermesTagDefinitions(scope, "must roll back")).toEqual([]);
		expect(getHermesSessionMetadata(sessionIdentity).tags).toHaveLength(64);
	});
});
