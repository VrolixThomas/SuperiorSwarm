import { sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/better-sqlite3";
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

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's generic constraints make a typed helper
// impractical here; the call sites below all pass real schema tables.
function countRows(db: Db, table: any): number {
	const result = db.select({ c: sql<number>`count(*)` }).from(table).all();
	return Number(result[0]?.c ?? 0);
}

function hasAnyRow(db: Db, table: Parameters<typeof countRows>[1]): boolean {
	return countRows(db, table) > 0;
}

export function buildSnapshot(db: Db, env: SnapshotEnv): UsageSnapshot {
	const state = getTelemetryState(db);
	const now = new Date();

	return {
		user_id: env.userId,
		app_version: env.appVersion,
		os_platform: env.osPlatform,
		os_arch: env.osArch,
		locale: env.locale,

		first_launch_at: state?.firstLaunchAt.toISOString() ?? null,
		first_signed_in_at: state?.firstSignedInAt?.toISOString() ?? null,
		last_synced_at: now.toISOString(),
		auth_provider: env.authProvider,

		project_count: countRows(db, schema.projects),
		workspace_count: countRows(db, schema.workspaces),
		worktree_count: countRows(db, schema.worktrees),
		terminal_session_count: countRows(db, schema.terminalSessions),
		tracked_pr_count: countRows(db, schema.trackedPrs),
		review_draft_count: countRows(db, schema.reviewDrafts),
		quick_action_count: countRows(db, schema.quickActions),
		extension_path_count: countRows(db, schema.extensionPaths),

		github_connected: hasAnyRow(db, schema.githubAuth),
		linear_connected: hasAnyRow(db, schema.linearAuth),
		atlassian_connected: hasAnyRow(db, schema.atlassianAuth),

		ever_used_ai_review: hasAnyRow(db, schema.reviewDrafts),
		ever_used_comment_solver: hasAnyRow(db, schema.commentSolveSessions),

		lifetime_sessions_started: state?.lifetimeSessionsStarted ?? 0,
		lifetime_reviews_started: state?.lifetimeReviewsStarted ?? 0,
		lifetime_comments_solved: state?.lifetimeCommentsSolved ?? 0,
	};
}
