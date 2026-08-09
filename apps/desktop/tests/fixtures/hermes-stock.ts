export const stockSessionList = {
	version: "0.15.0",
	sessions: [
		{
			id: "stored-slack-1",
			profile: "work",
			title: "Slack handoff",
			summary: "Continue the release plan",
			source: "slack",
			created_at: "2026-08-09T08:00:00.000Z",
			updated_at: "2026-08-09T10:30:00.000Z",
			status: "idle",
			message_count: 4,
			session_key: "agent:work:slack:channel:T01234567:C01234567:1786269600.123456",
			chat_id: "C01234567",
			thread_id: "1786269600.123456",
			origin_json: {
				team_id: "T01234567",
				user_id: "U01234567",
			},
		},
		{
			stored_session_id: "stored-local-1",
			profile_name: "default",
			title: "Local task",
			preview: "Inspect the build",
			source: "desktop",
			created_at: 1_786_268_400,
			last_active: 1_786_280_400,
			archived: true,
			running: false,
		},
	],
};

export const stockMessagePage = {
	stored_session_id: "stored-slack-1-tip",
	total: 3,
	messages: [
		{
			id: "message-3",
			role: "assistant",
			content: [{ type: "text", text: "Done" }],
			created_at: "2026-08-09T10:03:00.000Z",
		},
		{
			id: "message-2",
			role: "tool",
			name: "terminal",
			content: "Tests passed",
			created_at: "2026-08-09T10:02:00.000Z",
		},
	],
};

export const stockSessionDetail = {
	id: "stored-slack-1-tip",
	profile: "work",
	source: "slack",
	display_name: "#release · thread",
	session_key: "agent:work:slack:channel:T01234567:C01234567:1786269600.123456",
	chat_id: "C01234567",
	thread_id: "1786269600.123456",
	origin_json: JSON.stringify({
		team_id: "T01234567",
		team_name: "Acme",
		user_id: "U01234567",
	}),
};
