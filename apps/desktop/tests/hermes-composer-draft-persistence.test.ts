import "./preload-electron-mock";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { _setDbForTesting, schema } from "../src/main/db";
import {
	getHermesComposerDraft,
	setHermesComposerDraft,
} from "../src/main/hermes/hermes-composer-drafts";
import { t } from "../src/main/trpc";
import { hermesRouter } from "../src/main/trpc/routers/hermes";
import type { HermesComposerDraftIdentity } from "../src/shared/hermes";
import { makeTestDb } from "./test-db";

const identity = (
	overrides: Partial<HermesComposerDraftIdentity> = {}
): HermesComposerDraftIdentity => ({
	connectionId: "connection-a",
	managerId: "manager-a",
	projectId: "project-a",
	profileId: "work",
	durableSessionId: "same-session",
	...overrides,
});

describe("Hermes composer draft persistence", () => {
	let db: ReturnType<typeof makeTestDb>;

	beforeEach(() => {
		db = makeTestDb();
		_setDbForTesting(db);
		const now = new Date();
		db.insert(schema.hermesConnections)
			.values(
				["connection-a", "connection-b"].map((id) => ({
					id,
					label: id,
					baseUrl: `https://${id}.example.com`,
					profileId: "work",
					managerId: null,
					managerBindingMode: "manual" as const,
					managementMode: "external" as const,
					encryptedToken: null,
					tokenStorage: "memory" as const,
					lastConnectedAt: null,
					createdAt: now,
					updatedAt: now,
				}))
			)
			.run();
	});

	afterEach(() => {
		_setDbForTesting(null);
	});

	test("isolates same-named durable sessions across the complete local identity", () => {
		const drafts = [
			[identity(), "connection a / manager a / work"],
			[identity({ connectionId: "connection-b" }), "connection b"],
			[identity({ managerId: "manager-b" }), "manager b"],
			[identity({ projectId: "project-b" }), "project b"],
			[identity({ profileId: "personal" }), "personal profile"],
			[identity({ durableSessionId: "other-session" }), "other session"],
		] as const;

		for (const [key, text] of drafts) setHermesComposerDraft(key, text);

		for (const [key, text] of drafts) expect(getHermesComposerDraft(key)).toBe(text);
	});

	test("re-reads durable text without retaining renderer state", () => {
		setHermesComposerDraft(identity(), "survives reload and restart");

		expect(getHermesComposerDraft({ ...identity() })).toBe("survives reload and restart");
	});

	test("survives closing and reopening the migrated app database", () => {
		const directory = mkdtempSync(join(tmpdir(), "hermes-composer-draft-"));
		const databasePath = join(directory, "superiorswarm.db");
		try {
			const firstSqlite = new Database(databasePath);
			const firstDb = drizzle(firstSqlite, { schema });
			migrate(firstDb, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
			const now = new Date();
			firstDb
				.insert(schema.hermesConnections)
				.values({
					id: "restart-connection",
					label: "Restart connection",
					baseUrl: "https://restart.example.com",
					profileId: "work",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			_setDbForTesting(firstDb);
			const restartIdentity = identity({ connectionId: "restart-connection" });
			setHermesComposerDraft(restartIdentity, "exact text across app restart\n");
			firstSqlite.close();

			const secondSqlite = new Database(databasePath);
			const secondDb = drizzle(secondSqlite, { schema });
			_setDbForTesting(secondDb);
			expect(getHermesComposerDraft(restartIdentity)).toBe("exact text across app restart\n");
			secondSqlite.close();
		} finally {
			_setDbForTesting(db);
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("deletes empty drafts instead of retaining empty rows", () => {
		setHermesComposerDraft(identity(), "temporary text");
		setHermesComposerDraft(identity(), "");

		expect(getHermesComposerDraft(identity())).toBe("");
		expect(
			db
				.select()
				.from(schema.hermesComposerDrafts)
				.where(eq(schema.hermesComposerDrafts.connectionId, "connection-a"))
				.all()
		).toHaveLength(0);
	});

	test("derives manager scope in main and isolates explicit project scopes over typed IPC", async () => {
		const now = new Date();
		for (const managerId of ["manager-a", "manager-b"]) {
			db.insert(schema.crossRepoOrchestrators)
				.values({
					id: managerId,
					name: managerId,
					workDir: `/tmp/${managerId}`,
					agentKind: "external",
					status: "idle",
					sortOrder: 0,
					kind: "external",
					tokenHash: managerId.repeat(8).slice(0, 64),
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}
		db.update(schema.hermesConnections)
			.set({ managerId: "manager-a" })
			.where(eq(schema.hermesConnections.id, "connection-a"))
			.run();
		const caller = t.createCallerFactory(hermesRouter)({});
		const scope = {
			connectionId: "connection-a",
			profileId: "work",
			durableSessionId: "same-session",
		};

		await caller.setComposerDraft({ ...scope, projectId: "project-a", text: "project a" });
		await caller.setComposerDraft({ ...scope, projectId: "project-b", text: "project b" });
		expect(await caller.composerDraft({ ...scope, projectId: "project-a" })).toBe("project a");
		expect(await caller.composerDraft({ ...scope, projectId: "project-b" })).toBe("project b");

		db.update(schema.hermesConnections)
			.set({ managerId: "manager-b" })
			.where(eq(schema.hermesConnections.id, "connection-a"))
			.run();
		expect(await caller.composerDraft({ ...scope, projectId: "project-a" })).toBe("");
	});
});
