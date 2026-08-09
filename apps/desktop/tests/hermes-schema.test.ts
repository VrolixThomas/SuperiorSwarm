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

		const indexes = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(indexes).toContain("hermes_session_workspaces_unique");
		expect(indexes).toContain("hermes_origin_reports_unique");
		expect(indexes).toContain("hermes_session_admissions_manager_profile_idx");

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
		const connectionColumns = sqlite
			.prepare("PRAGMA table_info(hermes_connections)")
			.all()
			.map((row) => (row as { name: string }).name);
		expect(connectionColumns).toContain("management_mode");

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
