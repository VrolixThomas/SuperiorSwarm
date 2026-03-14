// apps/desktop/src/renderer/components/CommentOverview.tsx
import { useMemo, useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type {
	AIDraftThread,
	GitHubPRContext,
	GitHubPRDetails,
	UnifiedThread,
} from "../../shared/github-types";
import { useTabStore } from "../stores/tab-store";

type SortMode = "by-file" | "by-reviewer" | "latest-first";

function threadAuthor(t: UnifiedThread): string {
	if (t.isAIDraft) return "BranchFlux AI";
	return t.comments[0]?.author ?? "Unknown";
}

function threadDate(t: UnifiedThread): string {
	if (t.isAIDraft) return t.createdAt;
	return t.comments[0]?.createdAt ?? "";
}

function threadBody(t: UnifiedThread): string {
	if (t.isAIDraft) return t.userEdit ?? t.body;
	return t.comments[0]?.body ?? "";
}

function firstLine(text: string): string {
	const line = text.split("\n")[0] ?? "";
	return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

/** Small author indicator: AI badge or initial circle */
function AuthorIndicator({ thread }: { thread: UnifiedThread }) {
	if (thread.isAIDraft) {
		return <span className="ai-badge shrink-0">AI</span>;
	}
	const author = thread.comments[0]?.author ?? "?";
	const initial = author[0]?.toUpperCase() ?? "?";
	return (
		<span
			className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--bg-overlay)] text-[9px] font-semibold text-[var(--text-tertiary)]"
			title={author}
		>
			{initial}
		</span>
	);
}

function CommentRow({
	thread,
	prCtx,
}: {
	thread: UnifiedThread;
	prCtx: GitHubPRContext;
}) {
	const openPRReviewFile = useTabStore((s) => s.openPRReviewFile);
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);

	const filePath = thread.path;
	const filename = filePath.split("/").pop() ?? filePath;
	const line = thread.line;
	const body = firstLine(threadBody(thread));
	const isApproved = thread.isAIDraft && thread.status === "approved";

	return (
		<button
			type="button"
			onClick={() => {
				if (!activeWorkspaceId) return;
				openPRReviewFile(activeWorkspaceId, prCtx, filePath, detectLanguage(filePath));
			}}
			className="flex w-full items-center gap-1.5 rounded-[4px] px-2 py-1 text-left text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
		>
			<AuthorIndicator thread={thread} />

			<span className="shrink-0 font-mono text-[10px] text-[var(--text-tertiary)]">
				{filename}
				{line != null && `:${line}`}
			</span>

			<span className="min-w-0 flex-1 truncate text-[var(--text-quaternary)]">{body}</span>

			{isApproved && (
				<span className="shrink-0 text-[10px] text-green-400" title="Accepted">
					&#10003;
				</span>
			)}
		</button>
	);
}

function GroupHeader({ label }: { label: string }) {
	return (
		<div className="px-2 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-quaternary)]">
			{label}
		</div>
	);
}

export function CommentOverview({
	details,
	prCtx,
	aiThreads,
}: {
	details: GitHubPRDetails;
	prCtx: GitHubPRContext;
	aiThreads: AIDraftThread[];
}) {
	const [sortMode, setSortMode] = useState<SortMode>("by-file");
	const [collapsed, setCollapsed] = useState(false);

	const allThreads: UnifiedThread[] = useMemo(() => {
		const ghThreads: UnifiedThread[] = details.reviewThreads.map((t) => ({
			...t,
			isAIDraft: false as const,
		}));
		return [...ghThreads, ...aiThreads];
	}, [details.reviewThreads, aiThreads]);

	const totalCount = allThreads.length;

	const grouped = useMemo(() => {
		if (sortMode === "latest-first") {
			return null; // flat list
		}
		const map = new Map<string, UnifiedThread[]>();
		for (const t of allThreads) {
			const key = sortMode === "by-file" ? t.path : threadAuthor(t);
			const list = map.get(key);
			if (list) {
				list.push(t);
			} else {
				map.set(key, [t]);
			}
		}
		return map;
	}, [allThreads, sortMode]);

	const flatSorted = useMemo(() => {
		if (sortMode !== "latest-first") return null;
		return [...allThreads].sort(
			(a, b) => new Date(threadDate(b)).getTime() - new Date(threadDate(a)).getTime()
		);
	}, [allThreads, sortMode]);

	if (totalCount === 0) return null;

	return (
		<div className="border-t border-[var(--border-subtle)]">
			{/* Section header */}
			<div className="flex items-center gap-2 px-3 py-1.5">
				<button
					type="button"
					onClick={() => setCollapsed((v) => !v)}
					className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]"
				>
					<span
						className="text-[10px] text-[var(--text-quaternary)] transition-transform"
						style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
					>
						&#9660;
					</span>
					Comments ({totalCount})
				</button>

				<div className="flex-1" />

				<select
					value={sortMode}
					onChange={(e) => setSortMode(e.target.value as SortMode)}
					className="rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)] outline-none"
				>
					<option value="by-file">By file</option>
					<option value="by-reviewer">By reviewer</option>
					<option value="latest-first">Latest first</option>
				</select>
			</div>

			{/* Body */}
			{!collapsed && (
				<div className="max-h-[300px] overflow-y-auto pb-1">
					{sortMode === "latest-first" && flatSorted
						? flatSorted.map((t) => <CommentRow key={t.id} thread={t} prCtx={prCtx} />)
						: grouped &&
							Array.from(grouped.entries()).map(([key, threads]) => (
								<div key={key}>
									<GroupHeader label={key} />
									{threads.map((t) => (
										<CommentRow key={t.id} thread={t} prCtx={prCtx} />
									))}
								</div>
							))}
				</div>
			)}
		</div>
	);
}
