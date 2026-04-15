import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import * as schema from "../src/main/db/schema";
import { buildSnapshot } from "../src/main/telemetry/snapshot";
import { ensureTelemetryState } from "../src/main/telemetry/state";
import { makeTestDb } from "./test-db";

function freshDb() {
	const db = makeTestDb();
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
	test("produces defaults for an empty db", () => {
		const db = freshDb();
		const snap = buildSnapshot(db, {
			userId: "user-abc",
			authProvider: "github",
			...env,
		});
		expect(snap.user_id).toBe("user-abc");
		expect(snap.app_version).toBe("0.4.11");
		expect(snap.auth_provider).toBe("github");
		expect(snap.github_connected).toBe(false);
		expect(snap.linear_connected).toBe(false);
		expect(snap.jira_connected).toBe(false);
		expect(snap.bitbucket_connected).toBe(false);
		expect(snap.ever_used_ai_review).toBe(false);
		expect(snap.ever_used_comment_solver).toBe(false);
		expect(snap.lifetime_sessions_started).toBe(0);
	});

	test("flips integration booleans when auth rows exist", () => {
		const db = freshDb();
		db.insert(schema.githubAuth)
			.values({ id: "ga1", accessToken: "tok", accountId: "acct-1" })
			.run();
		db.insert(schema.atlassianAuth)
			.values({
				service: "jira",
				accessToken: "tok",
				refreshToken: "rtok",
				expiresAt: new Date(Date.now() + 3600_000),
				accountId: "acct-j",
			})
			.run();

		const snap = buildSnapshot(db, {
			userId: "user-abc",
			authProvider: "github",
			...env,
		});
		expect(snap.github_connected).toBe(true);
		expect(snap.jira_connected).toBe(true);
		expect(snap.bitbucket_connected).toBe(false);
	});
});
