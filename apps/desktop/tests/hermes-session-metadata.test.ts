import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { _setDbForTesting, getDb, schema } from "../src/main/db";
import {
	HermesSessionMetadataConflictError,
	addHermesSessionTag,
	applyHermesSessionMetadata,
	deleteHermesSessionMetadata,
	getHermesSessionMetadata,
	removeHermesSessionTag,
	setHermesSessionTags,
	setHermesSessionTitle,
} from "../src/main/hermes/hermes-session-metadata";
import type { HermesSessionSummary } from "../src/shared/hermes";
import { makeRawTestDb, makeTestDb } from "./test-db";

const baseIdentity = {
	managerId: "manager-a",
	connectionId: "connection-a",
	profileId: "work",
	durableSessionId: "shared-session",
};

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

function session(title: string): HermesSessionSummary {
	return {
		id: baseIdentity.durableSessionId,
		lineageRootId: baseIdentity.durableSessionId,
		activeTipId: baseIdentity.durableSessionId,
		title,
		generatedTitle: title,
		titleSource: "generated",
		tags: [],
		metadataRevision: 0,
		preview: "",
		profileId: baseIdentity.profileId,
		source: "superiorswarm",
		updatedAt: 1,
		createdAt: 1,
		archived: false,
		running: false,
		busy: false,
		waitingForUser: false,
		messageCount: 0,
		isCron: false,
		handover: false,
		admissionReason: null,
		origin: null,
	};
}

describe("Hermes durable session metadata", () => {
	beforeEach(() => {
		_setDbForTesting(makeTestDb());
		seedManagerAndConnection("manager-a", "connection-a");
		seedManagerAndConnection("manager-a", "connection-b");
		seedManagerAndConnection("manager-b", "connection-c");
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("preserves changing generated titles until an explicit trimmed rename", () => {
		expect(getHermesSessionMetadata(baseIdentity)).toEqual({
			customTitle: null,
			tags: [],
			revision: 0,
			updatedAt: null,
		});
		expect(applyHermesSessionMetadata(baseIdentity, session("Generated first"))).toMatchObject({
			title: "Generated first",
			generatedTitle: "Generated first",
			titleSource: "generated",
			tags: [],
			metadataRevision: 0,
		});
		expect(applyHermesSessionMetadata(baseIdentity, session("Generated later"))).toMatchObject({
			title: "Generated later",
			titleSource: "generated",
		});

		const renamed = setHermesSessionTitle({
			...baseIdentity,
			title: "  Release readiness  ",
			expectedRevision: 0,
		});
		expect(renamed).toMatchObject({ customTitle: "Release readiness", revision: 1 });
		expect(applyHermesSessionMetadata(baseIdentity, session("Generated newest"))).toMatchObject({
			title: "Release readiness",
			generatedTitle: "Generated newest",
			titleSource: "custom",
			metadataRevision: 1,
		});
		expect(() =>
			setHermesSessionTitle({
				...baseIdentity,
				title: " \n\t ",
				expectedRevision: 1,
			})
		).toThrow("Session name cannot be empty");
		expect(() =>
			setHermesSessionTitle({
				...baseIdentity,
				title: "ﬃ".repeat(200),
				expectedRevision: 1,
			})
		).toThrow("Session name must be 200 characters or fewer");
		expect(getHermesSessionMetadata(baseIdentity)).toMatchObject({
			customTitle: "Release readiness",
			revision: 1,
		});
	});

	test("normalizes ordered arbitrary-text tags with deterministic duplicate and whitespace rules", () => {
		const set = setHermesSessionTags({
			...baseIdentity,
			tags: [" urgent ", "customer report", "urgent", "Urgent", "emoji 🚀"],
			expectedRevision: 0,
		});
		expect(set).toMatchObject({
			tags: [
				expect.objectContaining({ name: "urgent", color: "gray" }),
				expect.objectContaining({ name: "customer report", color: "gray" }),
				expect.objectContaining({ name: "emoji 🚀", color: "gray" }),
			],
			revision: 1,
		});

		const duplicate = addHermesSessionTag({ ...baseIdentity, tag: "  urgent  " });
		expect(duplicate).toMatchObject({ tags: set.tags, revision: 1 });
		const added = addHermesSessionTag({ ...baseIdentity, tag: " needs follow-up " });
		expect(added).toMatchObject({
			tags: [...set.tags, expect.objectContaining({ name: "needs follow-up", color: "gray" })],
			revision: 2,
		});
		const removed = removeHermesSessionTag({ ...baseIdentity, tag: " customer report " });
		expect(removed).toMatchObject({
			tags: [
				expect.objectContaining({ name: "urgent" }),
				expect.objectContaining({ name: "emoji 🚀" }),
				expect.objectContaining({ name: "needs follow-up" }),
			],
			revision: 3,
		});
		const absent = removeHermesSessionTag({ ...baseIdentity, tag: "not present" });
		expect(absent).toMatchObject({ tags: removed.tags, revision: 3 });

		expect(() => addHermesSessionTag({ ...baseIdentity, tag: "  \t " })).toThrow(
			"Tag cannot be empty"
		);
		expect(() => addHermesSessionTag({ ...baseIdentity, tag: `${"x".repeat(100)} ` })).toThrow(
			"Tag must be 100 characters or fewer"
		);
		expect(() =>
			setHermesSessionTags({
				...baseIdentity,
				tags: ["valid", "\n"],
				expectedRevision: 3,
			})
		).toThrow("Tag cannot be empty");
		expect(getHermesSessionMetadata(baseIdentity)).toMatchObject({
			tags: removed.tags,
			revision: 3,
		});
	});

	test("fails stale replacements without losing a concurrent mutation", () => {
		setHermesSessionTitle({
			...baseIdentity,
			title: "First name",
			expectedRevision: 0,
		});
		expect(() =>
			setHermesSessionTags({
				...baseIdentity,
				tags: ["stale"],
				expectedRevision: 0,
			})
		).toThrow(HermesSessionMetadataConflictError);
		expect(getHermesSessionMetadata(baseIdentity)).toEqual(
			expect.objectContaining({ customTitle: "First name", tags: [], revision: 1 })
		);
	});

	test("isolates the complete manager, connection, profile, and durable-session identity", () => {
		const identities = [
			baseIdentity,
			{ ...baseIdentity, managerId: "manager-b", connectionId: "connection-c" },
			{ ...baseIdentity, connectionId: "connection-b" },
			{ ...baseIdentity, profileId: "personal" },
			{ ...baseIdentity, durableSessionId: "other-session" },
		] as const;
		for (const [index, identity] of identities.entries()) {
			setHermesSessionTags({
				...identity,
				tags: [`scope ${index}`],
				expectedRevision: 0,
			});
		}

		for (const [index, identity] of identities.entries()) {
			expect(getHermesSessionMetadata(identity)).toMatchObject({
				tags: [expect.objectContaining({ name: `scope ${index}` })],
				revision: 1,
			});
		}
		expect(getDb().select().from(schema.hermesSessionMetadata).all()).toHaveLength(5);
	});

	test("survives a database restart, exposes metadata only, and deletes exact local state", () => {
		setHermesSessionTitle({
			...baseIdentity,
			title: "Durable name",
			expectedRevision: 0,
		});
		addHermesSessionTag({ ...baseIdentity, tag: "durable tag" });
		const currentDb = getDb();
		const raw = (currentDb as unknown as { $client: Database.Database }).$client;
		const serialized = raw.serialize();
		const restartedRaw = new Database(serialized);
		restartedRaw.pragma("foreign_keys = ON");
		_setDbForTesting(drizzle(restartedRaw, { schema }));

		const restarted = getHermesSessionMetadata(baseIdentity);
		expect(restarted).toMatchObject({
			customTitle: "Durable name",
			tags: [expect.objectContaining({ name: "durable tag", color: "gray" })],
			revision: 2,
		});
		const serializedDto = JSON.stringify(restarted);
		expect(serializedDto).not.toContain("transcript");
		expect(serializedDto).not.toContain("worktree");
		expect(serializedDto).not.toContain("token");

		deleteHermesSessionMetadata(baseIdentity);
		expect(getHermesSessionMetadata(baseIdentity)).toEqual({
			customTitle: null,
			tags: [],
			revision: 0,
			updatedAt: null,
		});
		restartedRaw.close();
	});

	test("database defaults are safe when a row is inserted without optional metadata", () => {
		const raw = makeRawTestDb();
		raw
			.prepare(
				`INSERT INTO cross_repo_orchestrators
			 (id, name, work_dir, agent_kind, status, sort_order, kind, token_hash,
			  dispatch_policy, access_scope, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				"raw-manager",
				"Raw manager",
				"/manager",
				"external",
				"idle",
				0,
				"external",
				"f".repeat(64),
				"confirm",
				"all",
				1,
				1
			);
		raw
			.prepare(
				`INSERT INTO hermes_connections
			 (id, label, base_url, profile_id, manager_id, management_mode, token_storage,
			  created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				"raw-connection",
				"Raw connection",
				"https://example.test",
				"default",
				"raw-manager",
				"external",
				"memory",
				1,
				1
			);
		raw
			.prepare(
				`INSERT INTO hermes_session_metadata
			 (manager_id, connection_id, profile_id, durable_session_id, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run("raw-manager", "raw-connection", "default", "session", 1, 1);
		expect(
			raw
				.prepare(
					"SELECT custom_title, tags_json, revision FROM hermes_session_metadata WHERE durable_session_id = ?"
				)
				.get("session")
		).toEqual({ custom_title: null, tags_json: "[]", revision: 0 });
		raw.close();
	});

	test("falls back safely when persisted display metadata is malformed", () => {
		const now = new Date();
		getDb()
			.insert(schema.hermesSessionMetadata)
			.values({
				...baseIdentity,
				customTitle: "\t",
				legacyTagsJson: '["valid", 42]',
				revision: 7,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		expect(getHermesSessionMetadata(baseIdentity)).toMatchObject({
			customTitle: null,
			tags: [],
			revision: 7,
		});
		expect(applyHermesSessionMetadata(baseIdentity, session("Generated fallback"))).toMatchObject({
			title: "Generated fallback",
			titleSource: "generated",
			tags: [],
			metadataRevision: 7,
		});
	});
});
