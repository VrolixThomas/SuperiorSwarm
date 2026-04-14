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
	project_count: number;
	workspace_count: number;
	worktree_count: number;
	terminal_session_count: number;
	tracked_pr_count: number;
	review_draft_count: number;
	quick_action_count: number;
	extension_path_count: number;
	github_connected: boolean;
	linear_connected: boolean;
	atlassian_connected: boolean;
	ever_used_ai_review: boolean;
	ever_used_comment_solver: boolean;
	lifetime_sessions_started: number;
	lifetime_reviews_started: number;
	lifetime_comments_solved: number;
}
