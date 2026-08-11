import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/main/db/schema";

describe("Hermes persistence migration", () => {
	test("registers secure connections, workspace/origin links, and local report receipts", () => {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });

		const tableNames = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all()
			.map((row) => (row as { name: string }).name);

		expect(tableNames).toContain("hermes_connections");
		expect(tableNames).toContain("hermes_session_workspaces");
		expect(tableNames).toContain("hermes_origin_links");
		expect(tableNames).toContain("hermes_origin_reports");
		expect(tableNames).toContain("hermes_session_admissions");
		expect(tableNames).toContain("hermes_composer_drafts");
		expect(tableNames).toContain("hermes_session_metadata");
		expect(tableNames).toContain("hermes_tag_definitions");
		expect(tableNames).toContain("hermes_session_tag_assignments");

		const indexes = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(indexes).toContain("hermes_session_workspaces_unique");
		expect(indexes).toContain("hermes_origin_reports_unique");
		expect(indexes).toContain("hermes_session_admissions_manager_profile_idx");
		expect(indexes).toContain("hermes_composer_drafts_connection_idx");

		const composerDraftColumns = sqlite
			.prepare("PRAGMA table_info(hermes_composer_drafts)")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(composerDraftColumns).toEqual([
			"manager_id",
			"project_id",
			"connection_id",
			"profile_id",
			"durable_session_id",
			"text",
			"updated_at",
		]);
		expect(composerDraftColumns).not.toContain("attachment_handles");
		expect(composerDraftColumns).not.toContain("path");
		expect(composerDraftColumns).not.toContain("transcript");
		expect(composerDraftColumns).not.toContain("credentials");

		expect(indexes).toContain("hermes_session_metadata_connection_idx");
		expect(indexes).toContain("hermes_tag_definitions_scope_key_unique");
		expect(indexes).toContain("hermes_session_tag_assignments_session_idx");

		const metadataColumns = sqlite
			.prepare("PRAGMA table_info(hermes_session_metadata)")
			.all()
			.map(
				(row) => row as { name: string; notnull: number; dflt_value: string | null; pk: number }
			);
		expect(metadataColumns).toEqual([
			expect.objectContaining({ name: "manager_id", notnull: 1, pk: 1 }),
			expect.objectContaining({ name: "connection_id", notnull: 1, pk: 2 }),
			expect.objectContaining({ name: "profile_id", notnull: 1, pk: 3 }),
			expect.objectContaining({ name: "durable_session_id", notnull: 1, pk: 4 }),
			expect.objectContaining({ name: "custom_title", notnull: 0 }),
			expect.objectContaining({ name: "tags_json", notnull: 1, dflt_value: "'[]'" }),
			expect.objectContaining({ name: "revision", notnull: 1, dflt_value: "0" }),
			expect.objectContaining({ name: "created_at", notnull: 1 }),
			expect.objectContaining({ name: "updated_at", notnull: 1 }),
		]);
		const metadataForeignKeys = sqlite
			.prepare("PRAGMA foreign_key_list(hermes_session_metadata)")
			.all()
			.map((row) => row as { from: string; table: string; on_delete: string });
		expect(metadataForeignKeys).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					from: "manager_id",
					table: "cross_repo_orchestrators",
					on_delete: "CASCADE",
				}),
				expect.objectContaining({
					from: "connection_id",
					table: "hermes_connections",
					on_delete: "CASCADE",
				}),
			])
		);

		const admissionColumns = sqlite
			.prepare("PRAGMA table_info(hermes_session_admissions)")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(admissionColumns).toEqual([
			"manager_id",
			"profile_id",
			"durable_session_id",
			"admission_reason",
			"source_platform",
			"is_cron",
			"first_seen_at",
			"last_seen_at",
		]);

		const reportColumns = sqlite
			.prepare("PRAGMA table_info(hermes_origin_reports)")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(reportColumns).toContain("message_key");
		expect(reportColumns).toContain("profile_id");
		expect(reportColumns).toContain("content_hash");
		expect(reportColumns).toContain("destination_fingerprint");
		expect(reportColumns).toContain("attempt_count");
		expect(reportColumns).toContain("provider_message_id");
		const connectionColumnRows = sqlite
			.prepare("PRAGMA table_info(hermes_connections)")
			.all()
			.map((row) => row as { name: string; notnull: number });
		const connectionColumns = connectionColumnRows.map((row) => row.name);
		expect(connectionColumns).toContain("management_mode");
		expect(connectionColumns).toContain("manager_id");
		expect(connectionColumns).toContain("manager_binding_mode");
		expect(connectionColumnRows.find((row) => row.name === "manager_binding_mode")?.notnull).toBe(
			0
		);
		const connectionForeignKeys = sqlite
			.prepare("PRAGMA foreign_key_list(hermes_connections)")
			.all()
			.map((row) => row as { from: string; table: string; on_delete: string });
		expect(connectionForeignKeys).toContainEqual(
			expect.objectContaining({
				from: "manager_id",
				table: "cross_repo_orchestrators",
				on_delete: "SET NULL",
			})
		);

		sqlite.close();
	});

	test("enforces the fixed reusable-tag palette in persisted definitions", () => {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		sqlite.exec(`
			INSERT INTO cross_repo_orchestrators
				(id, name, work_dir, agent_kind, sort_order, created_at, updated_at)
				VALUES ('manager', 'Manager', '/manager', 'external', 0, 1, 1);
			INSERT INTO hermes_connections
				(id, label, base_url, profile_id, created_at, updated_at)
				VALUES ('connection', 'Connection', 'https://example.test', 'work', 1, 1);
		`);

		expect(() =>
			sqlite
				.prepare(`
					INSERT INTO hermes_tag_definitions
						(id, manager_id, connection_id, profile_id, name, normalized_key, color, created_at, updated_at)
						VALUES ('tag', 'manager', 'connection', 'work', 'Unsafe', 'unsafe', '#fff', 1, 1)
				`)
				.run()
		).toThrow(/CHECK constraint failed/);
		sqlite.close();
	});

	test("backfills legacy workspace links from their connection profile and permits profile collisions", () => {
		const sqlite = new Database(":memory:");
		sqlite.exec(`
			CREATE TABLE hermes_connections (
				id text PRIMARY KEY NOT NULL,
				profile_id text NOT NULL
			);
			CREATE TABLE hermes_session_workspaces (
				id text PRIMARY KEY NOT NULL,
				connection_id text NOT NULL REFERENCES hermes_connections(id) ON DELETE CASCADE,
				hermes_session_id text NOT NULL,
				hermes_lineage_root_id text,
				workspace_id text NOT NULL,
				source text NOT NULL,
				linked_at integer NOT NULL
			);
			CREATE UNIQUE INDEX hermes_session_workspaces_unique
				ON hermes_session_workspaces (connection_id, hermes_session_id, workspace_id);
			CREATE INDEX hermes_session_workspaces_session_idx
				ON hermes_session_workspaces (connection_id, hermes_session_id);
			CREATE INDEX hermes_session_workspaces_workspace_idx
				ON hermes_session_workspaces (workspace_id);
			INSERT INTO hermes_connections (id, profile_id) VALUES ('connection-1', 'work');
			INSERT INTO hermes_session_workspaces
				(id, connection_id, hermes_session_id, workspace_id, source, linked_at)
				VALUES ('legacy-link', 'connection-1', 'shared-session', 'workspace-1', 'manual', 1);
		`);

		const migration = readFileSync(
			join(
				import.meta.dir,
				"../src/main/db/migrations/0061_isolate_hermes_workspace_links_by_profile.sql"
			),
			"utf8"
		).replaceAll("--> statement-breakpoint", "");
		sqlite.exec(migration);

		expect(
			sqlite
				.prepare("SELECT profile_id FROM hermes_session_workspaces WHERE id = ?")
				.get("legacy-link")
		).toEqual({ profile_id: "work" });
		const profileColumn = sqlite
			.prepare("PRAGMA table_info(hermes_session_workspaces)")
			.all()
			.map((row) => row as { name: string; notnull: number; dflt_value: string | null })
			.find((row) => row.name === "profile_id");
		expect(profileColumn).toMatchObject({ notnull: 1, dflt_value: "'default'" });

		sqlite
			.prepare(
				`INSERT INTO hermes_session_workspaces
				 (id, connection_id, profile_id, hermes_session_id, workspace_id, source, linked_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				"personal-link",
				"connection-1",
				"personal",
				"shared-session",
				"workspace-1",
				"manual",
				2
			);
		sqlite
			.prepare(
				`INSERT INTO hermes_session_workspaces
				 (id, connection_id, hermes_session_id, workspace_id, source, linked_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run("default-link", "connection-1", "new-session", "workspace-2", "manual", 3);
		expect(
			sqlite.prepare("SELECT id, profile_id FROM hermes_session_workspaces ORDER BY id").all()
		).toEqual([
			{ id: "default-link", profile_id: "default" },
			{ id: "legacy-link", profile_id: "work" },
			{ id: "personal-link", profile_id: "personal" },
		]);
		sqlite.close();
	});

	test("adds session metadata without rewriting existing manager or connection rows", () => {
		const sqlite = new Database(":memory:");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(`
			CREATE TABLE cross_repo_orchestrators (
				id text PRIMARY KEY NOT NULL,
				name text NOT NULL
			);
			CREATE TABLE hermes_connections (
				id text PRIMARY KEY NOT NULL,
				manager_id text REFERENCES cross_repo_orchestrators(id) ON DELETE SET NULL
			);
			INSERT INTO cross_repo_orchestrators (id, name) VALUES ('manager-1', 'Manager');
			INSERT INTO hermes_connections (id, manager_id) VALUES ('connection-1', 'manager-1');
		`);

		const migration = readFileSync(
			join(import.meta.dir, "../src/main/db/migrations/0063_add_hermes_session_metadata.sql"),
			"utf8"
		).replaceAll("--> statement-breakpoint", "");
		sqlite.exec(migration);

		expect(sqlite.prepare("SELECT * FROM cross_repo_orchestrators").all()).toEqual([
			{ id: "manager-1", name: "Manager" },
		]);
		expect(sqlite.prepare("SELECT * FROM hermes_connections").all()).toEqual([
			{ id: "connection-1", manager_id: "manager-1" },
		]);
		sqlite
			.prepare(
				`INSERT INTO hermes_session_metadata
				 (manager_id, connection_id, profile_id, durable_session_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run("manager-1", "connection-1", "work", "session-1", 1, 1);
		expect(sqlite.prepare("SELECT tags_json, revision FROM hermes_session_metadata").get()).toEqual(
			{ tags_json: "[]", revision: 0 }
		);
		sqlite.close();
	});

	test("replays the resequenced metadata migration over the rejected fork migration safely", () => {
		const sqlite = new Database(":memory:");
		sqlite.exec(`
			CREATE TABLE cross_repo_orchestrators (id text PRIMARY KEY NOT NULL);
			CREATE TABLE hermes_connections (id text PRIMARY KEY NOT NULL);
			INSERT INTO cross_repo_orchestrators (id) VALUES ('manager-1');
			INSERT INTO hermes_connections (id) VALUES ('connection-1');
			CREATE TABLE hermes_session_metadata (
				manager_id text NOT NULL,
				connection_id text NOT NULL,
				profile_id text NOT NULL,
				durable_session_id text NOT NULL,
				custom_title text,
				tags_json text DEFAULT '[]' NOT NULL,
				revision integer DEFAULT 0 NOT NULL,
				created_at integer NOT NULL,
				updated_at integer NOT NULL,
				PRIMARY KEY(manager_id, connection_id, profile_id, durable_session_id),
				FOREIGN KEY (manager_id) REFERENCES cross_repo_orchestrators(id) ON DELETE cascade,
				FOREIGN KEY (connection_id) REFERENCES hermes_connections(id) ON DELETE cascade
			);
			CREATE INDEX hermes_session_metadata_connection_idx
				ON hermes_session_metadata (connection_id, profile_id, durable_session_id);
			INSERT INTO hermes_session_metadata
				(manager_id, connection_id, profile_id, durable_session_id, custom_title,
				 tags_json, revision, created_at, updated_at)
				VALUES ('manager-1', 'connection-1', 'work', 'session-1', 'Keep me',
					'["Urgent","Customer"]', 3, 1, 2);
			CREATE TABLE __drizzle_migrations (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric
			);
			INSERT INTO __drizzle_migrations (hash, created_at)
				VALUES ('rejected-0062-session-metadata', 1786468969471);
		`);
		const db = drizzle(sqlite, { schema });

		expect(() =>
			migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") })
		).not.toThrow();
		expect(sqlite.prepare("SELECT * FROM hermes_session_metadata").get()).toEqual({
			manager_id: "manager-1",
			connection_id: "connection-1",
			profile_id: "work",
			durable_session_id: "session-1",
			custom_title: "Keep me",
			tags_json: '["Urgent","Customer"]',
			revision: 3,
			created_at: 1,
			updated_at: 2,
		});
		expect(
			sqlite
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?) ORDER BY name"
				)
				.all("hermes_composer_drafts", "hermes_tag_definitions", "hermes_session_tag_assignments")
		).toEqual([
			{ name: "hermes_composer_drafts" },
			{ name: "hermes_session_tag_assignments" },
			{ name: "hermes_tag_definitions" },
		]);
		sqlite.close();
	});

	test("migrates only deterministic legacy Local Hermes defaults and preserves rollback data", () => {
		const sqlite = new Database(":memory:");
		const migrations = join(import.meta.dir, "../src/main/db/migrations");
		let advancedLoopbackBefore: unknown = null;
		for (const name of [
			"0054_add_hermes_connections_links_reports.sql",
			"0055_adapt_hermes_stock_sessions.sql",
			"0056_manage_local_hermes_backend.sql",
		]) {
			if (name.startsWith("0055")) {
				const insertConnection = sqlite.prepare(
					`INSERT INTO hermes_connections
						 (id, label, base_url, profile_id, encrypted_token, token_storage, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				);
				for (const fixture of [
					[
						"legacy-local-a",
						"Local Hermes",
						"http://127.0.0.1:8080",
						"default",
						"legacy-ciphertext-a",
					],
					[
						"advanced-loopback",
						"Local Hermes",
						"http://127.0.0.1:9119",
						"default",
						"advanced-ciphertext",
					],
					[
						"custom-label",
						"Development Hermes",
						"http://127.0.0.1:8080",
						"default",
						"custom-label-ciphertext",
					],
					[
						"custom-profile",
						"Local Hermes",
						"http://127.0.0.1:8080",
						"work",
						"custom-profile-ciphertext",
					],
					[
						"external-loopback-lookalike",
						"External Hermes",
						"http://127.0.0.1.example.com:8080",
						"default",
						"protected-external-token",
					],
					[
						"legacy-local-b",
						"Local Hermes",
						"http://127.0.0.1:8080",
						"default",
						"legacy-ciphertext-b",
					],
				] as const) {
					insertConnection.run(...fixture, "safe-storage", 1, 1);
				}
			}
			if (name.startsWith("0056")) {
				advancedLoopbackBefore = sqlite
					.prepare(
						`SELECT id, label, base_url, profile_id, encrypted_token, token_storage,
								last_connected_at, created_at, updated_at
						 FROM hermes_connections WHERE id = ?`
					)
					.get("advanced-loopback");
			}
			const sql = readFileSync(join(migrations, name), "utf8").replaceAll(
				"--> statement-breakpoint",
				""
			);
			sqlite.exec(sql);
		}

		for (const [id, ciphertext] of [
			["legacy-local-a", "legacy-ciphertext-a"],
			["legacy-local-b", "legacy-ciphertext-b"],
		]) {
			expect(sqlite.prepare("SELECT * FROM hermes_connections WHERE id = ?").get(id)).toMatchObject(
				{
					label: "Local Hermes",
					base_url: "http://127.0.0.1:8080",
					profile_id: "default",
					management_mode: "managed",
					encrypted_token: ciphertext,
					token_storage: "safe-storage",
				}
			);
		}
		for (const [id, label, baseUrl, profileId, ciphertext] of [
			[
				"advanced-loopback",
				"Local Hermes",
				"http://127.0.0.1:9119",
				"default",
				"advanced-ciphertext",
			],
			[
				"custom-label",
				"Development Hermes",
				"http://127.0.0.1:8080",
				"default",
				"custom-label-ciphertext",
			],
			[
				"custom-profile",
				"Local Hermes",
				"http://127.0.0.1:8080",
				"work",
				"custom-profile-ciphertext",
			],
			[
				"external-loopback-lookalike",
				"External Hermes",
				"http://127.0.0.1.example.com:8080",
				"default",
				"protected-external-token",
			],
		] as const) {
			expect(sqlite.prepare("SELECT * FROM hermes_connections WHERE id = ?").get(id)).toMatchObject(
				{
					label,
					base_url: baseUrl,
					profile_id: profileId,
					management_mode: "external",
					encrypted_token: ciphertext,
					token_storage: "safe-storage",
				}
			);
		}
		expect(
			sqlite
				.prepare(
					`SELECT id, label, base_url, profile_id, encrypted_token, token_storage,
							last_connected_at, created_at, updated_at
					 FROM hermes_connections WHERE id = ?`
				)
				.get("advanced-loopback")
		).toEqual(advancedLoopbackBefore);
		sqlite.close();
	});

	test("replaces incompatible fork report receipts without breaking an upgrade", () => {
		const sqlite = new Database(":memory:");
		const migrations = join(import.meta.dir, "../src/main/db/migrations");
		for (const name of [
			"0054_add_hermes_connections_links_reports.sql",
			"0055_adapt_hermes_stock_sessions.sql",
		]) {
			if (name.startsWith("0055")) {
				sqlite
					.prepare(
						`INSERT INTO hermes_connections
						 (id, label, base_url, profile_id, token_storage, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?)`
					)
					.run("connection-1", "Local", "http://localhost:8080", "default", "memory", 1, 1);
				sqlite
					.prepare(
						`INSERT INTO hermes_origin_reports
						 (id, connection_id, hermes_session_id, turn_id, idempotency_key, status, retryable, created_at, updated_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
					)
					.run("old-1", "connection-1", "session-1", "turn-1", "fork-key", "sent", 0, 1, 1);
			}
			const sql = readFileSync(join(migrations, name), "utf8").replaceAll(
				"--> statement-breakpoint",
				""
			);
			sqlite.exec(sql);
		}

		const columns = sqlite
			.prepare("PRAGMA table_info(hermes_origin_reports)")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns).toContain("destination_fingerprint");
		expect(columns).not.toContain("idempotency_key");
		expect(
			(
				sqlite.prepare("SELECT COUNT(*) AS count FROM hermes_origin_reports").get() as {
					count: number;
				}
			).count
		).toBe(0);
		sqlite.close();
	});
});
