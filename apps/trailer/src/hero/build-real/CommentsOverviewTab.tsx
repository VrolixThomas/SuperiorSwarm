// Mirrors apps/desktop/src/renderer/components/CommentsOverviewTab.tsx. Static (no tRPC, no stores) — hardcoded threads grouped by file.

interface MockThread {
	id: string;
	path: string;
	line: number;
	author: string;
	initials: string;
	date: string;
	body: string;
	isResolved: boolean;
	draftReply?: string;
}

const PR_TITLE = "feat: agent terminal chat";
const PR_NUMBER = "214";
const SOURCE_BRANCH = "feat/agent-terminal-chat";

const THREADS: MockThread[] = [
	{
		id: "t1",
		path: "src/renderer/hooks/useAgentTerminalStream.ts",
		line: 42,
		author: "sam",
		initials: "SR",
		date: "2h ago",
		body: "Cancel the stream subscription when the terminal closes — we're leaking handlers on unmount.",
		isResolved: false,
		draftReply: "Good catch, fixed in d8f3a2.",
	},
	{
		id: "t2",
		path: "src/renderer/components/Terminal.tsx",
		line: 88,
		author: "jordan",
		initials: "JR",
		date: "1h ago",
		body: "Pass `theme` through so light mode picks up the right ANSI palette.",
		isResolved: true,
	},
	{
		id: "t3",
		path: "src/renderer/main/mcp/mcp-server-registry.ts",
		line: 16,
		author: "sam",
		initials: "SR",
		date: "12m ago",
		body: "Keep MCP server identifiers stable across refreshes — clients are caching them.",
		isResolved: false,
	},
];

function PRHeader({
	title,
	prNumber,
	sourceBranch,
	commentCount,
}: {
	title: string;
	prNumber: string | null;
	sourceBranch: string | null;
	commentCount: number;
}) {
	return (
		<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
			<div className="flex items-center gap-2">
				<h1 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
					{title}
				</h1>
			</div>
			<div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
				{prNumber && <span className="text-[var(--text-tertiary)]">#{prNumber}</span>}
				{sourceBranch && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span
							className="text-[var(--text-quaternary)]"
							style={{ fontFamily: "var(--font-mono)" }}
						>
							{sourceBranch}
						</span>
					</>
				)}
				{commentCount > 0 && (
					<>
						<span className="text-[var(--text-quaternary)]">&middot;</span>
						<span className="text-[var(--text-quaternary)]">
							{commentCount} comment{commentCount !== 1 ? "s" : ""}
						</span>
					</>
				)}
			</div>
		</div>
	);
}

function ThreadCard({ thread }: { thread: MockThread }) {
	const filename = thread.path.split("/").pop() ?? thread.path;
	return (
		<div className="mx-2 mb-1.5 overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1">
				<span className="font-mono text-[10px] text-[var(--text-quaternary)]">
					{filename}:{thread.line}
				</span>
				<div className="flex-1" />
				{thread.isResolved ? (
					<span className="text-[10px] text-[var(--color-success)]">Resolved</span>
				) : (
					<span className="text-[10px] text-[var(--text-quaternary)]">Open</span>
				)}
			</div>

			<div className="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0">
				<div className="mb-0.5 flex items-center gap-1.5 text-[10px]">
					<span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[8px] font-semibold text-[var(--text-secondary)]">
						{thread.initials}
					</span>
					<span className="font-medium text-[var(--text-secondary)]">{thread.author}</span>
					<span className="text-[var(--text-quaternary)]">{thread.date}</span>
				</div>
				<div className="text-[11px] leading-[1.5] text-[var(--text)]">{thread.body}</div>
			</div>

			{!thread.isResolved && (
				<div className="px-3 pb-2">
					{thread.draftReply ? (
						<>
							<div className="w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text)]">
								{thread.draftReply}
							</div>
							<div className="mt-0.5 text-[9px] text-[var(--text-quaternary)]">
								Enter to send &middot; Shift+Enter for new line &middot; Esc to cancel
							</div>
						</>
					) : (
						<div className="w-full resize-none rounded-[4px] border border-transparent bg-transparent px-0 py-0.5 text-[11px] text-[var(--text-quaternary)]">
							Reply...
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function CommentsOverviewTab() {
	const sortMode = "by-file" as const;

	const threads = THREADS;
	const resolvedCount = threads.filter((t) => t.isResolved).length;
	const unresolvedCount = threads.length - resolvedCount;

	const grouped = new Map<string, MockThread[]>();
	for (const t of threads) {
		const list = grouped.get(t.path);
		if (list) list.push(t);
		else grouped.set(t.path, [t]);
	}

	return (
		<div className="flex flex-1 min-h-0 flex-col bg-[var(--bg-base)]">
			<PRHeader
				title={PR_TITLE}
				prNumber={PR_NUMBER}
				sourceBranch={SOURCE_BRANCH}
				commentCount={threads.length}
			/>

			<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3 py-1.5">
				<div className="flex items-center gap-[6px]">
					<span className="rounded-full bg-[var(--success-subtle)] px-[7px] py-[1px] text-[9px] font-semibold text-[var(--color-success)]">
						{resolvedCount} resolved
					</span>
					<span className="rounded-full bg-[var(--bg-elevated)] px-[7px] py-[1px] text-[9px] font-semibold text-[var(--text-secondary)]">
						{unresolvedCount} unresolved
					</span>
					<span className="rounded-full bg-[var(--bg-elevated)] px-[7px] py-[1px] text-[9px] font-semibold text-[var(--text-tertiary)]">
						{threads.length} total
					</span>
				</div>
				<div className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
					By file
				</div>
			</div>

			<div className="flex-1 overflow-y-auto py-1">
				{sortMode === "by-file" &&
					Array.from(grouped.entries()).map(([key, groupThreads]) => (
						<div key={key}>
							<div className="px-3 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
								{key}
							</div>
							{groupThreads.map((t) => (
								<ThreadCard key={t.id} thread={t} />
							))}
						</div>
					))}
			</div>

			<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5">
				<div className="w-full rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-center text-[12px] font-medium text-[var(--accent-foreground)]">
					Solve with AI ({unresolvedCount} comment{unresolvedCount !== 1 ? "s" : ""})
				</div>
			</div>
		</div>
	);
}
