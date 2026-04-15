import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/better-sqlite3";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";
import type { UsageSnapshot } from "../../shared/telemetry";
import * as schema from "../db/schema";
import { getTelemetryState } from "./state";

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface SnapshotEnv {
	userId: string;
	authProvider: string | null;
	appVersion: string;
	osPlatform: string;
	osArch: string;
	locale: string | null;
}

function hasAnyRow(db: Db, table: AnySQLiteTable): boolean {
	return db.select({ one: sql`1` }).from(table).limit(1).get() !== undefined;
}

export function buildSnapshot(db: Db, env: SnapshotEnv): UsageSnapshot {
	const state = getTelemetryState(db);
	const lifetimeReviews = state?.lifetimeReviewsStarted ?? 0;
	const lifetimeSolves = state?.lifetimeCommentsSolved ?? 0;

	const atlassianServices = db
		.select({ service: schema.atlassianAuth.service })
		.from(schema.atlassianAuth)
		.all();

	return {
		user_id: env.userId,
		app_version: env.appVersion,
		os_platform: env.osPlatform,
		os_arch: env.osArch,
		locale: env.locale,
		first_launch_at: state?.firstLaunchAt.toISOString() ?? null,
		first_signed_in_at: state?.firstSignedInAt?.toISOString() ?? null,
		last_synced_at: new Date().toISOString(),
		auth_provider: env.authProvider,

		github_connected: hasAnyRow(db, schema.githubAuth),
		linear_connected: hasAnyRow(db, schema.linearAuth),
		jira_connected: atlassianServices.some((s) => s.service === "jira"),
		bitbucket_connected: atlassianServices.some((s) => s.service === "bitbucket"),

		ever_used_ai_review: lifetimeReviews > 0,
		ever_used_comment_solver: lifetimeSolves > 0,

		lifetime_sessions_started: state?.lifetimeSessionsStarted ?? 0,
		lifetime_reviews_started: lifetimeReviews,
		lifetime_comments_solved: lifetimeSolves,
	};
}
