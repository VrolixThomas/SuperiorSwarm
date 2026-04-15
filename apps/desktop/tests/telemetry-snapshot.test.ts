import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../src/main/telemetry/snapshot";
import { ensureTelemetryState, markProviderConnected } from "../src/main/telemetry/state";
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
		expect(snap.ever_connected_github).toBe(false);
		expect(snap.ever_connected_linear).toBe(false);
		expect(snap.ever_connected_jira).toBe(false);
		expect(snap.ever_connected_bitbucket).toBe(false);
		expect(snap.ever_used_ai_review).toBe(false);
		expect(snap.ever_used_comment_solver).toBe(false);
		expect(snap.lifetime_sessions_started).toBe(0);
	});

	test("ever_connected flags stay true after markProviderConnected", () => {
		const db = freshDb();
		markProviderConnected(db, "github");
		markProviderConnected(db, "jira");

		const snap = buildSnapshot(db, {
			userId: "user-abc",
			authProvider: "github",
			...env,
		});
		expect(snap.ever_connected_github).toBe(true);
		expect(snap.ever_connected_jira).toBe(true);
		expect(snap.ever_connected_bitbucket).toBe(false);
		expect(snap.ever_connected_linear).toBe(false);
	});
});
