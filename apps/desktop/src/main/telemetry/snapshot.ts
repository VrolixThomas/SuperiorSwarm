import type { drizzle } from "drizzle-orm/better-sqlite3";
import type { UsageSnapshot } from "../../shared/telemetry";
import type * as schema from "../db/schema";
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

export function buildSnapshot(db: Db, env: SnapshotEnv): UsageSnapshot {
	const state = getTelemetryState(db);
	const lifetimeReviews = state?.lifetimeReviewsStarted ?? 0;
	const lifetimeSolves = state?.lifetimeCommentsSolved ?? 0;

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

		ever_connected_github: state?.everConnectedGithub ?? false,
		ever_connected_linear: state?.everConnectedLinear ?? false,
		ever_connected_jira: state?.everConnectedJira ?? false,
		ever_connected_bitbucket: state?.everConnectedBitbucket ?? false,

		ever_used_ai_review: lifetimeReviews > 0,
		ever_used_comment_solver: lifetimeSolves > 0,

		lifetime_sessions_started: state?.lifetimeSessionsStarted ?? 0,
		lifetime_reviews_started: lifetimeReviews,
		lifetime_comments_solved: lifetimeSolves,
	};
}
