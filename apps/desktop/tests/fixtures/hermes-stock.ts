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
		platform: "slack",
		chat_id: "C01234567",
		chat_name: "#release",
		chat_type: "channel",
		thread_id: "1786269600.123456",
		user_name: "Maya",
		scope_id: "T01234567",
		guild_id: "T01234567",
		user_id: "U01234567",
	}),
};

export const stockMessagingSidebar = {
	recents: {
		sessions: [
			{
				id: "stored-local",
				profile: "default",
				title: "Local investigation",
				source: "superiorswarm",
				last_active: 40,
			},
		],
	},
	cron: { sessions: [] },
	messaging: {
		sessions: [
			{
				id: "stored-slack",
				profile: "work",
				title: "Slack release",
				source: "slack",
				display_name: "#release",
				last_active: 30,
				thread_id: "1786269600.123456",
				origin_json: JSON.stringify({
					platform: "slack",
					chat_id: "C01234567",
					chat_name: "#release",
					chat_type: "channel",
					user_id: "U01234567",
					user_name: "Maya",
					thread_id: "1786269600.123456",
					scope_id: "T01234567",
					guild_id: "T01234567",
				}),
			},
			{
				id: "stored-telegram",
				profile: "personal",
				title: "Telegram incident",
				source: "telegram",
				display_name: "Ops room",
				last_active: 20,
				thread_id: "77",
				origin_json: JSON.stringify({
					platform: "telegram",
					chat_id: "-1001234567890",
					chat_name: "Ops room",
					chat_type: "group",
					user_id: "99887766",
					user_name: "Alex",
					thread_id: "77",
					chat_topic: "Release incident",
				}),
			},
			{
				id: "stored-custom",
				profile: "default",
				title: "Custom adapter",
				source: "custom_adapter",
				display_name: "Customer bridge",
				last_active: 10,
				origin_json: JSON.stringify({
					platform: "custom_adapter",
					chat_id: "raw-route-id",
					chat_name: "Customer bridge",
					chat_type: "group",
					user_id: "raw-account-id",
					user_name: "On-call",
				}),
			},
		],
	},
};

export const stockTelegramSessionDetail = {
	id: "stored-telegram",
	profile: "personal",
	source: "telegram",
	display_name: "Ops room",
	session_key: "agent:personal:telegram:group:-1001234567890:77",
	chat_id: "-1001234567890",
	chat_type: "group",
	thread_id: "77",
	origin_json: JSON.stringify({
		platform: "telegram",
		chat_id: "-1001234567890",
		chat_name: "Ops room",
		chat_type: "group",
		user_id: "99887766",
		user_name: "Alex",
		thread_id: "77",
		chat_topic: "Release incident",
	}),
};
