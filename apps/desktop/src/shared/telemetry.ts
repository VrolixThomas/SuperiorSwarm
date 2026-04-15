export const PRIVACY_URL = "https://github.com/VrolixThomas/SuperiorSwarm/blob/main/PRIVACY.md";

export interface UsageSnapshot {
	user_id: string;
	app_version: string;
	os_platform: string;
	os_arch: string;
	locale: string | null;
	first_launch_at: string | null; // ISO string
	first_signed_in_at: string | null; // ISO string
	last_synced_at: string; // ISO string
	auth_provider: string | null;
	ever_connected_github: boolean;
	ever_connected_linear: boolean;
	ever_connected_jira: boolean;
	ever_connected_bitbucket: boolean;
	ever_used_ai_review: boolean;
	ever_used_comment_solver: boolean;
	lifetime_sessions_started: number;
	lifetime_reviews_started: number;
	lifetime_comments_solved: number;
}
