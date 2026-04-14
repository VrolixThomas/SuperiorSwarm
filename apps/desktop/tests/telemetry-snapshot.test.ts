import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../src/main/db/schema";
import { buildSnapshot } from "../src/main/telemetry/snapshot";
import { ensureTelemetryState } from "../src/main/telemetry/state";

function freshDb() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: join(__dirname, "../src/main/db/migrations") });
	ensureTelemetryState(db);
	return db;
}

const env = {
	appVersion: "0.4.11",
	osPlatform: "darwin",
	osArch: "arm64",
	locale: "en-US",
};

describe("buildSnapshot", () => {
	test("produces zero counts for an empty db", () => {
		const db = freshDb();
		const snap = buildSnapshot(db, {
			userId: "user-abc",
			authProvider: "github",
			...env,
		});
		expect(snap.user_id).toBe("user-abc");
		expect(snap.app_version).toBe("0.4.11");
		expect(snap.auth_provider).toBe("github");
		expect(snap.project_count).toBe(0);
		expect(snap.workspace_count).toBe(0);
		expect(snap.github_connected).toBe(false);
		expect(snap.ever_used_ai_review).toBe(false);
		expect(snap.lifetime_sessions_started).toBe(0);
	});

	test("counts projects, workspaces, worktrees and sets github_connected when a row exists", () => {
		const db = freshDb();
		const now = new Date();
		db.insert(schema.projects)
			.values({
				id: "p1",
				name: "proj",
				repoPath: "/tmp/p1",
				defaultBranch: "main",
				status: "ready",
				createdAt: now,
				updatedAt: now,
			})
			.run();
		db.insert(schema.githubAuth)
			.values({ id: "ga1", accessToken: "tok", accountId: "acct-1" })
			.run();

		const snap = buildSnapshot(db, {
			userId: "user-abc",
			authProvider: "github",
			...env,
		});
		expect(snap.project_count).toBe(1);
		expect(snap.github_connected).toBe(true);
	});
});
