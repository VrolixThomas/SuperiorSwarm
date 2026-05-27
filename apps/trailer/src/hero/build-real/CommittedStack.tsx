// Mirrors apps/desktop/src/renderer/components/CommittedStack.tsx. Static (no
// tRPC, no stores) — hardcoded commits, all collapsed.

interface DiffFile {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed" | "binary";
	additions: number;
	deletions: number;
}

interface Commit {
	hash: string;
	shortHash: string;
	message: string;
	time: string;
	additions: number;
	deletions: number;
	files: DiffFile[];
}

function CommitCard({ commit }: { commit: Commit }) {
	const expanded = false;

	return (
		<div className="mx-1.5 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]">
			{/* Collapsed header — always visible */}
			<button
				type="button"
				className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)]"
			>
				<div className="flex w-full items-center gap-2">
					<span
						className="shrink-0 text-[11px] text-[var(--text-quaternary)]"
						style={{ fontFamily: "var(--font-mono)" }}
					>
						{commit.shortHash}
					</span>
					<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
						{commit.message}
					</span>
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">{commit.time}</span>
				</div>
				<div className="flex w-full items-center gap-2">
					<span className="text-[11px]">
						{commit.additions > 0 && (
							<span className="text-[var(--term-green)]">+{commit.additions}</span>
						)}
						{commit.deletions > 0 && (
							<span className="ml-1 text-[var(--term-red)]">-{commit.deletions}</span>
						)}
					</span>
					<span className="text-[11px] text-[var(--text-quaternary)]">
						· {commit.files.length} file{commit.files.length !== 1 ? "s" : ""}
					</span>
					<div className="flex-1" />
					<span
						className="text-[10px] text-[var(--text-quaternary)] transition-transform duration-150"
						style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
					>
						▾
					</span>
				</div>
			</button>
		</div>
	);
}

export function CommittedStack() {
	const commits: Commit[] = [
		{
			hash: "d8f3a2",
			shortHash: "d8f3a2",
			message: "fix(stream): cancel terminal subscriptions",
			time: "just now",
			additions: 9,
			deletions: 0,
			files: [
				{
					path: "src/renderer/hooks/useAgentTerminalStream.ts",
					status: "modified",
					additions: 9,
					deletions: 0,
				},
			],
		},
		{
			hash: "a4b261",
			shortHash: "a4b261",
			message: "fix(mcp): preserve server identity",
			time: "4 min ago",
			additions: 18,
			deletions: 0,
			files: [
				{
					path: "src/renderer/main/mcp/mcp-server-registry.ts",
					status: "modified",
					additions: 18,
					deletions: 0,
				},
			],
		},
		{
			hash: "61a962",
			shortHash: "61a962",
			message: "test(review): cover comment resolution order",
			time: "9 min ago",
			additions: 31,
			deletions: 0,
			files: [
				{
					path: "src/renderer/main/ai-review/comment-solver.test.ts",
					status: "added",
					additions: 31,
					deletions: 0,
				},
			],
		},
	];

	return (
		<div className="flex flex-col gap-1 pb-4">
			{/* Section header */}
			<div className="flex items-center gap-2 px-3 py-1.5">
				<span className="text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
					Commits
				</span>
				{commits.length > 0 && (
					<span className="rounded-full bg-[var(--bg-overlay)] px-1.5 py-px text-[10px] text-[var(--text-tertiary)]">
						{commits.length}
					</span>
				)}
			</div>

			{/* Commit cards */}
			{commits.map((commit) => (
				<CommitCard key={commit.hash} commit={commit} />
			))}
		</div>
	);
}
