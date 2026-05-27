// Project tree — matches real app's OrchestratorGroupNode + loose structure
// (apps/desktop/src/renderer/components/ProjectItem.tsx)
export const PROJECTS = [
	{
		id: "ss",
		name: "SuperiorSwarm",
		source: "github" as const,
		orchestrators: [
			{
				id: "orch-release",
				name: "Release v1.0",
				colorIndex: 1 as const,
				children: [
					{
						id: "w-feature",
						name: "orchestrator-ordering",
						active: true,
						statusText: "3 agents running",
						currentPhase: "working" as const,
					},
					{
						id: "w-review",
						name: "review/PR-110",
						active: false,
					},
					{
						id: "w-voice",
						name: "voice-input",
						active: false,
					},
				],
			},
		],
		loose: [
			{ id: "w-main", name: "main", active: false },
			{ id: "w-fix", name: "fix/terminal-scrollback", active: false },
		],
	},
	{
		id: "docs",
		name: "superiorswarm-docs",
		source: "github" as const,
		orchestrators: [],
		loose: [{ id: "d-main", name: "main", active: false }],
	},
] as const;

// PR list grouped by repo (from real app PRs sidebar)
export const PULL_REQUESTS = [
	{
		repo: "VROLIXTHOMAS/SUPERIORSWARM",
		source: "github" as const,
		prs: [
			{
				id: 34,
				title: "Orchestrator workspace ordering with drag-and-drop",
				branch: "orchestrator-ordering",
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
		title: "Reorder orchestrator workspaces via drag-and-drop",
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

// PR comments / review threads (AI review on PR #34 — orchestrator reordering)
export const PR_COMMENTS = [
	{
		file: "src/renderer/components/ProjectItem.tsx",
		threads: [
			{
				line: 142,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "The optimistic reorder updates local state before `reorderTopLevel` resolves but never reverts on error. A rejected mutation leaves the sidebar showing an order the backend never accepted. Roll back to the previous order in onError.",
			},
			{
				line: 168,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "@dnd-kit is configured with `closestCenter`, so nested workspaces snap to the wrong orchestrator on fast drags. Use `closestCorners` or constrain droppables to the active container.",
			},
		],
	},
	{
		file: "src/renderer/components/OrchestratorGroup.tsx",
		threads: [
			{
				line: 54,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "The reorder mutation fires on every `onDragOver` instead of `onDragEnd`, so a single drag dispatches dozens of writes. Persist the order only once when the drag completes.",
			},
			{
				line: 96,
				author: "PR Review Agent",
				date: "3/29/2026",
				text: "`arrayMove` is called with the pre-drag index after state has already shifted, producing an off-by-one when dragging downward. Capture the source index at drag start.",
			},
		],
	},
] as const;

// Comment solver commit groups (AI fixes for PR #34 — orchestrator reordering)
export const COMMIT_GROUPS = [
	{
		label: "Revert optimistic reorder on error + fix collision detection",
		resolved: 2,
		total: 2,
		approved: true,
		commits: ["a7f3c21"],
		files: ["ProjectItem.tsx"],
		comments: [
			{
				file: "ProjectItem.tsx",
				line: 142,
				author: "PR Review Agent",
				text: "The optimistic reorder updates local state before `reorderTopLevel` resolves but never reverts on error. A rejected mutation leaves the sidebar showing an order the backend never accepted. Roll back to the previous order in onError.",
			},
			{
				file: "ProjectItem.tsx",
				line: 168,
				author: "PR Review Agent",
				text: "@dnd-kit is configured with `closestCenter`, so nested workspaces snap to the wrong orchestrator on fast drags. Use `closestCorners` or constrain droppables to the active container.",
			},
		],
	},
	{
		label: "Persist order on drag end + fix arrayMove index",
		resolved: 2,
		total: 2,
		approved: true,
		commits: ["e4b8d09"],
		files: ["OrchestratorGroup.tsx"],
		comments: [
			{
				file: "OrchestratorGroup.tsx",
				line: 54,
				author: "PR Review Agent",
				text: "The reorder mutation fires on every `onDragOver` instead of `onDragEnd`, so a single drag dispatches dozens of writes. Persist the order only once when the drag completes.",
			},
			{
				file: "OrchestratorGroup.tsx",
				line: 96,
				author: "PR Review Agent",
				text: "`arrayMove` is called with the pre-drag index after state has already shifted, producing an off-by-one when dragging downward. Capture the source index at drag start.",
			},
		],
	},
] as const;

// Diff lines for the solver center panel — OrchestratorGroup.tsx reorder fix
// (persist on drag end with a captured source index instead of per drag-over)
export const DIFF_LINES = [
	{
		type: "context" as const,
		left: "50",
		right: "50",
		content: "  const sensors = useSensors(useSensor(PointerSensor));",
	},
	{ type: "context" as const, left: "51", right: "51", content: "" },
	{
		type: "remove" as const,
		left: "52",
		right: "",
		content: "  function handleDragOver(event: DragOverEvent) {",
	},
	{
		type: "remove" as const,
		left: "53",
		right: "",
		content: "    const { active, over } = event;",
	},
	{
		type: "remove" as const,
		left: "54",
		right: "",
		content: "    reorder.mutate({ id: active.id }); // fires on every move",
	},
	{
		type: "remove" as const,
		left: "55",
		right: "",
		content: "  }",
	},
	{
		type: "add" as const,
		left: "",
		right: "52",
		content: "  function handleDragEnd(event: DragEndEvent) {",
	},
	{
		type: "add" as const,
		left: "",
		right: "53",
		content: "    const { active, over } = event;",
	},
	{
		type: "add" as const,
		left: "",
		right: "54",
		content: "    if (!over || active.id === over.id) return;",
	},
	{
		type: "add" as const,
		left: "",
		right: "55",
		content: "    const from = items.findIndex((i) => i.id === active.id);",
	},
	{
		type: "add" as const,
		left: "",
		right: "56",
		content: "    const to = items.findIndex((i) => i.id === over.id);",
	},
	{
		type: "add" as const,
		left: "",
		right: "57",
		content: "    const next = arrayMove(items, from, to);",
	},
	{
		type: "add" as const,
		left: "",
		right: "58",
		content: "    setItems(next); // optimistic",
	},
	{
		type: "add" as const,
		left: "",
		right: "59",
		content: "    reorder.mutate(",
	},
	{
		type: "add" as const,
		left: "",
		right: "60",
		content: "      { orderedIds: next.map((i) => i.id) },",
	},
	{
		type: "add" as const,
		left: "",
		right: "61",
		content: "      { onError: () => setItems(items) }, // revert",
	},
	{
		type: "add" as const,
		left: "",
		right: "62",
		content: "    );",
	},
	{
		type: "add" as const,
		left: "",
		right: "63",
		content: "  }",
	},
	{ type: "context" as const, left: "56", right: "64", content: "" },
	{
		type: "context" as const,
		left: "57",
		right: "65",
		content: "  return (",
	},
	{
		type: "context" as const,
		left: "58",
		right: "66",
		content: "    <DndContext sensors={sensors} collisionDetection={closestCorners}>",
	},
] as const;

// Working changes for git panel
export const WORKING_CHANGES = [
	{ name: "ProjectItem.tsx" },
	{ name: "OrchestratorGroup.tsx" },
] as const;

// Commits list (feature branch commits for the orchestrator reordering feature)
export const COMMITS = [
	{
		hash: "e4b8d09",
		message: "fix: revert optimistic reorder when mutation fails",
		time: "12 min ago",
		additions: 18,
		deletions: 6,
		files: 1,
	},
	{
		hash: "b2c4a17",
		message: "fix: capture source index at drag start",
		time: "28 min ago",
		additions: 21,
		deletions: 4,
		files: 1,
	},
	{
		hash: "a7f3c21",
		message: "feat: persist order on drag end only",
		time: "43 min ago",
		additions: 34,
		deletions: 8,
		files: 1,
	},
	{
		hash: "8d1e5f3",
		message: "feat: add reorderTopLevel + reorderChildren tRPC procedures",
		time: "2 hours ago",
		additions: 74,
		deletions: 0,
		files: 1,
	},
	{
		hash: "3f7a9b2",
		message: "feat: wire @dnd-kit sortable context into ProjectItem",
		time: "3 hours ago",
		additions: 96,
		deletions: 8,
		files: 2,
	},
	{
		hash: "c5d2e84",
		message: "feat: add drag handle + sortable rows to OrchestratorRow",
		time: "4 hours ago",
		additions: 118,
		deletions: 5,
		files: 2,
	},
] as const;

// Right diff panel — Changes tab content for the orchestrator-ordering branch.
// File +/- and commit +/- both total +345 / -31 across 6 files / 3 commits (↑3).
export const DIFF_PANEL = {
	branch: "orchestrator-ordering",
	baseBranch: "main",
	ahead: 3,
	totalAdditions: 345,
	totalDeletions: 31,
	// Grouped by top-level dir (mirrors real BranchChanges groupByDirectory on parts[0])
	files: [
		{
			dir: "src",
			name: "ProjectItem.tsx",
			path: "src/renderer/components/ProjectItem.tsx",
			status: "modified" as const,
			additions: 118,
			deletions: 19,
		},
		{
			dir: "src",
			name: "OrchestratorGroup.tsx",
			path: "src/renderer/components/OrchestratorGroup.tsx",
			status: "modified" as const,
			additions: 96,
			deletions: 8,
		},
		{
			dir: "src",
			name: "OrchestratorRow.tsx",
			path: "src/renderer/components/OrchestratorRow.tsx",
			status: "modified" as const,
			additions: 21,
			deletions: 4,
		},
		{
			dir: "src",
			name: "workspaces.ts",
			path: "src/main/trpc/workspaces.ts",
			status: "modified" as const,
			additions: 74,
			deletions: 0,
		},
		{
			dir: "src",
			name: "projects.ts",
			path: "src/renderer/stores/projects.ts",
			status: "modified" as const,
			additions: 24,
			deletions: 0,
		},
		{
			dir: "src",
			name: "pane-types.ts",
			path: "src/shared/pane-types.ts",
			status: "modified" as const,
			additions: 12,
			deletions: 0,
		},
	],
	commits: [
		{
			shortHash: "e4b8d09",
			message: "feat: persist ordering via workspaces.reorder* procedures",
			time: "1 hour ago",
			additions: 110,
			deletions: 9,
			files: 2,
		},
		{
			shortHash: "a7f3c21",
			message: "feat: drag-and-drop orchestrator groups with @dnd-kit",
			time: "2 hours ago",
			additions: 152,
			deletions: 18,
			files: 3,
		},
		{
			shortHash: "3f7a9b2",
			message: "refactor: extract orchestrator ordering logic",
			time: "3 hours ago",
			additions: 83,
			deletions: 4,
			files: 1,
		},
	],
} as const;

// Branch changes
export const BRANCH_FILES = [
	{ name: "ProjectItem.tsx", path: "src/renderer/components/", additions: 118 },
	{ name: "OrchestratorGroup.tsx", path: "src/renderer/components/", additions: 96 },
	{ name: "OrchestratorRow.tsx", path: "src/renderer/components/", additions: 21 },
	{ name: "workspaces.ts", path: "src/main/trpc/", additions: 74 },
	{ name: "projects.ts", path: "src/renderer/stores/", additions: 24 },
] as const;

// File tree
export const FILE_TREE = [
	{
		name: "src",
		type: "dir" as const,
		children: [
			{ name: "main/trpc/workspaces.ts", type: "file" as const },
			{ name: "renderer/components/ProjectItem.tsx", type: "file" as const },
			{ name: "renderer/components/OrchestratorGroup.tsx", type: "file" as const },
			{ name: "renderer/components/OrchestratorRow.tsx", type: "file" as const },
			{ name: "renderer/stores/projects.ts", type: "file" as const },
			{ name: "shared/pane-types.ts", type: "file" as const },
		],
	},
	{ name: "package.json", type: "file" as const },
	{ name: "tsconfig.json", type: "file" as const },
] as const;
