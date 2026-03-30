// Projects with expandable branches (from real app Repos sidebar)
export const PROJECTS = [
	{
		name: "SuperiorSwarm",
		branches: [
			{ name: "main", active: false },
			{
				name: "feature/inline-agent-chat",
				active: true,
				subtitle: "3 agents running",
			},
			{ name: "fix/terminal-scrollback", active: false },
		],
	},
	{
		name: "superiorswarm-docs",
		branches: [{ name: "main", active: false }],
	},
] as const;

// PR list grouped by repo (from real app PRs sidebar)
export const PULL_REQUESTS = [
	{
		repo: "VROLIXTHOMAS/SUPERIORSWARM",
		prs: [
			{
				id: 34,
				title: "Add inline agent chat with streaming responses",
				branch: "feature/inline-agent-chat",
				target: "main",
				author: "ThomasV",
				authorInitial: "T",
				status: "success" as const,
			},
			{
				id: 31,
				title: "Fix terminal scrollback on session restore",
				branch: "fix/terminal-scrollback",
				target: "main",
				author: "ThomasV",
				authorInitial: "T",
				status: "success" as const,
			},
		],
	},
] as const;

// Tickets (SuperiorSwarm roadmap — real product features)
export const TICKETS = [
	{
		key: "SUP-12",
		title: "Inline agent chatting in terminal panes",
		status: "In Progress" as const,
		provider: "Linear" as const,
		project: "SuperiorSwarm",
	},
	{
		key: "SUP-11",
		title: "Worktree shared files configuration UI",
		status: "Todo" as const,
		provider: "Linear" as const,
		project: "SuperiorSwarm",
	},
	{
		key: "SUP-10",
		title: "Review draft follow-up rounds",
		status: "Todo" as const,
		provider: "Linear" as const,
		project: "SuperiorSwarm",
	},
	{
		key: "SUP-9",
		title: "Terminal scrollback persistence across restarts",
		status: "Done" as const,
		provider: "Linear" as const,
		project: "SuperiorSwarm",
	},
	{
		key: "SUP-8",
		title: "Drag-and-drop ticket board with status transitions",
		status: "Done" as const,
		provider: "Linear" as const,
		project: "SuperiorSwarm",
	},
	{
		key: "SUP-7",
		title: "PR enrichment: mergeable state and CI indicators",
		status: "Done" as const,
		provider: "Linear" as const,
		project: "SuperiorSwarm",
	},
] as const;

export const TICKET_STATUSES = [
	{ name: "Backlog" },
	{ name: "Todo" },
	{ name: "In Progress" },
	{ name: "Done" },
] as const;

// PR comments / review threads (AI review on PR #34)
export const PR_COMMENTS = [
	{
		file: "src/main/chat/chat-service.ts",
		threads: [
			{
				line: 47,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "Messages are dispatched without a queue. If two agents respond simultaneously, messages will interleave unpredictably. Add a message queue per conversation that serializes writes.",
			},
			{
				line: 89,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "The WebSocket connection has no reconnection logic. When the network drops, the agent session is lost silently. Implement exponential backoff reconnection with session resumption.",
			},
		],
	},
	{
		file: "src/renderer/components/ChatPanel.tsx",
		threads: [
			{
				line: 23,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "The `useEffect` that subscribes to the message stream doesn't return a cleanup function. This will leak subscriptions when the component unmounts or the conversation changes.",
			},
			{
				line: 156,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "Streaming message content is appended to state on every chunk without batching. With fast responses this causes hundreds of re-renders per second. Use `requestAnimationFrame` or batch state updates.",
			},
		],
	},
] as const;

// Comment solver commit groups (AI fixes for PR #34)
export const COMMIT_GROUPS = [
	{
		label: "Message queue and WebSocket reconnection in chat-service.ts",
		resolved: 2,
		total: 2,
		approved: true,
		commits: ["a7f3c21"],
		files: ["chat-service.ts"],
		comments: [
			{
				file: "chat-service.ts",
				line: 47,
				author: "PR Review Agent",
				text: "Messages are dispatched without a queue. If two agents respond simultaneously, messages will interleave unpredictably. Add a message queue per conversation that serializes writes.",
			},
			{
				file: "chat-service.ts",
				line: 89,
				author: "PR Review Agent",
				text: "The WebSocket connection has no reconnection logic. When the network drops, the agent session is lost silently. Implement exponential backoff reconnection with session resumption.",
			},
		],
	},
	{
		label: "ChatPanel subscription cleanup and render batching",
		resolved: 2,
		total: 2,
		approved: true,
		commits: ["e4b8d09"],
		files: ["ChatPanel.tsx"],
		comments: [
			{
				file: "ChatPanel.tsx",
				line: 23,
				author: "PR Review Agent",
				text: "The `useEffect` that subscribes to the message stream doesn't return a cleanup function. This will leak subscriptions when the component unmounts or the conversation changes.",
			},
			{
				file: "ChatPanel.tsx",
				line: 156,
				author: "PR Review Agent",
				text: "Streaming message content is appended to state on every chunk without batching. With fast responses this causes hundreds of re-renders per second. Use `requestAnimationFrame` or batch state updates.",
			},
		],
	},
] as const;

// Diff lines for the solver center panel — chat-service.ts message queue fix
export const DIFF_LINES = [
	{
		type: "context" as const,
		left: "42",
		right: "42",
		content: "export class ChatService {",
	},
	{
		type: "context" as const,
		left: "43",
		right: "43",
		content: "  private ws: WebSocket;",
	},
	{
		type: "add" as const,
		left: "",
		right: "44",
		content: "  private queue: MessageQueue;",
	},
	{
		type: "add" as const,
		left: "",
		right: "45",
		content: "  private reconnectAttempts = 0;",
	},
	{
		type: "context" as const,
		left: "44",
		right: "46",
		content: "",
	},
	{
		type: "remove" as const,
		left: "45",
		right: "",
		content: "  async send(message: ChatMessage): Promise<void> {",
	},
	{
		type: "remove" as const,
		left: "46",
		right: "",
		content: "    this.ws.send(JSON.stringify(message));",
	},
	{
		type: "remove" as const,
		left: "47",
		right: "",
		content: "  }",
	},
	{
		type: "add" as const,
		left: "",
		right: "47",
		content: "  async send(message: ChatMessage): Promise<void> {",
	},
	{
		type: "add" as const,
		left: "",
		right: "48",
		content: "    this.queue.enqueue(message);",
	},
	{
		type: "add" as const,
		left: "",
		right: "49",
		content: "    await this.queue.flush(this.ws);",
	},
	{
		type: "add" as const,
		left: "",
		right: "50",
		content: "  }",
	},
	{ type: "context" as const, left: "48", right: "51", content: "" },
	{
		type: "context" as const,
		left: "49",
		right: "52",
		content: "  private connect(url: string): void {",
	},
	{
		type: "remove" as const,
		left: "50",
		right: "",
		content: "    this.ws = new WebSocket(url);",
	},
	{
		type: "add" as const,
		left: "",
		right: "53",
		content: "    this.ws = this.createSocket(url);",
	},
	{
		type: "add" as const,
		left: "",
		right: "54",
		content: "    this.ws.onclose = () => this.reconnectWithBackoff(url);",
	},
	{
		type: "context" as const,
		left: "51",
		right: "55",
		content: "  }",
	},
	{ type: "context" as const, left: "52", right: "56", content: "" },
	{
		type: "add" as const,
		left: "",
		right: "57",
		content: "  private reconnectWithBackoff(url: string): void {",
	},
	{
		type: "add" as const,
		left: "",
		right: "58",
		content: "    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);",
	},
	{
		type: "add" as const,
		left: "",
		right: "59",
		content: "    setTimeout(() => {",
	},
	{
		type: "add" as const,
		left: "",
		right: "60",
		content: "      this.reconnectAttempts++;",
	},
	{
		type: "add" as const,
		left: "",
		right: "61",
		content: "      this.connect(url);",
	},
	{
		type: "add" as const,
		left: "",
		right: "62",
		content: "    }, delay);",
	},
	{
		type: "add" as const,
		left: "",
		right: "63",
		content: "  }",
	},
] as const;

// Working changes for git panel
export const WORKING_CHANGES = [{ name: "chat-service.ts" }, { name: "ChatPanel.tsx" }] as const;

// Commits list (feature branch commits for the chat feature)
export const COMMITS = [
	{
		hash: "e4b8d09",
		message: "fix: batch streaming renders with requestAnimationFrame",
		time: "12 min ago",
		additions: 18,
		deletions: 6,
		files: 1,
	},
	{
		hash: "b2c4a17",
		message: "fix: implement WebSocket reconnection with backoff",
		time: "28 min ago",
		additions: 52,
		deletions: 3,
		files: 1,
	},
	{
		hash: "a7f3c21",
		message: "fix: add message queue for concurrent agent responses",
		time: "43 min ago",
		additions: 34,
		deletions: 8,
		files: 1,
	},
	{
		hash: "8d1e5f3",
		message: "feat: add useAgentChat hook for conversation state",
		time: "2 hours ago",
		additions: 89,
		deletions: 0,
		files: 1,
	},
	{
		hash: "3f7a9b2",
		message: "feat: implement chat-service with WebSocket transport",
		time: "3 hours ago",
		additions: 245,
		deletions: 12,
		files: 2,
	},
	{
		hash: "c5d2e84",
		message: "feat: add ChatPanel component with streaming UI",
		time: "4 hours ago",
		additions: 187,
		deletions: 0,
		files: 3,
	},
] as const;

// Branch changes
export const BRANCH_FILES = [
	{ name: "ChatPanel.tsx", path: "src/renderer/components/", additions: 156 },
	{ name: "chat-service.ts", path: "src/main/chat/", additions: 198 },
	{ name: "useAgentChat.ts", path: "src/renderer/hooks/", additions: 89 },
	{ name: "ChatMessage.tsx", path: "src/renderer/components/", additions: 67 },
	{ name: "chat-types.ts", path: "src/shared/", additions: 34 },
] as const;

// File tree
export const FILE_TREE = [
	{
		name: "src",
		type: "dir" as const,
		children: [
			{ name: "main/chat/chat-service.ts", type: "file" as const },
			{ name: "main/chat/message-queue.ts", type: "file" as const },
			{ name: "renderer/components/ChatPanel.tsx", type: "file" as const },
			{ name: "renderer/components/ChatMessage.tsx", type: "file" as const },
			{ name: "renderer/hooks/useAgentChat.ts", type: "file" as const },
			{ name: "shared/chat-types.ts", type: "file" as const },
		],
	},
	{ name: "package.json", type: "file" as const },
	{ name: "tsconfig.json", type: "file" as const },
] as const;
