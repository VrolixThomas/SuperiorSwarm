create table public.usage_snapshots (
	user_id uuid primary key references auth.users(id) on delete cascade,

	-- install / environment
	app_version text not null,
	os_platform text not null,
	os_arch text not null,
	locale text,

	-- lifecycle
	first_launch_at timestamptz,
	first_signed_in_at timestamptz,
	last_synced_at timestamptz not null default now(),
	auth_provider text,

	-- integration adoption
	github_connected boolean not null default false,
	linear_connected boolean not null default false,
	jira_connected boolean not null default false,
	bitbucket_connected boolean not null default false,

	-- feature adoption
	ever_used_ai_review boolean not null default false,
	ever_used_comment_solver boolean not null default false,

	-- cumulative counters
	lifetime_sessions_started integer not null default 0,
	lifetime_reviews_started integer not null default 0,
	lifetime_comments_solved integer not null default 0
);

alter table public.usage_snapshots enable row level security;

create policy "users can upsert own snapshot"
	on public.usage_snapshots
	for all
	to authenticated
	using (auth.uid() = user_id)
	with check (auth.uid() = user_id);
