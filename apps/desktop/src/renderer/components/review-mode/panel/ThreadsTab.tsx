import { useMemo, useState } from "react";
import type { UnifiedThread } from "../../../../shared/github-types";
import type { ReviewPath } from "../../../../shared/review-path-types";
import { threadAuthor, threadExcerpt } from "../../../lib/pr-review-threads";
import { numberSteps, stepForPath } from "../../../lib/review-path-model";

interface ThreadsTabProps {
	threads: UnifiedThread[];
	path: ReviewPath | null;
	currentUser?: string;
	currentUserId?: string;
	onOpen: (thread: UnifiedThread) => void;
	onAsk: (question: string) => void;
}

export function ThreadsTab({
	threads,
	path,
	currentUser,
	currentUserId,
	onOpen,
	onAsk,
}: ThreadsTabProps) {
	const [filter, setFilter] = useState<"open" | "resolved" | "mine" | "unknown">("open");
	const groups = useMemo(() => {
		const numbers = path ? numberSteps(path) : new Map<string, number>();
		const result = new Map<string, UnifiedThread[]>();
		for (const thread of threads) {
			if (thread.isAIDraft) continue;
			if (filter === "open" && (thread.isResolved || thread.resolutionKnown === false)) continue;
			if (filter === "resolved" && (!thread.isResolved || thread.resolutionKnown === false))
				continue;
			if (filter === "unknown" && thread.resolutionKnown !== false) continue;
			if (
				filter === "mine" &&
				!thread.comments.some((c) =>
					c.authorId && currentUserId
						? c.authorId === currentUserId
						: !!currentUser && c.author === currentUser
				)
			)
				continue;
			const step = stepForPath(path, thread.path);
			const number = step ? numbers.get(step.id) : undefined;
			const label = number ? `${number} · ${thread.path.split("/").pop()}` : "Other files";
			result.set(label, [...(result.get(label) ?? []), thread]);
		}
		return [...result].sort(
			([a], [b]) =>
				(Number.parseInt(a) || Number.POSITIVE_INFINITY) -
				(Number.parseInt(b) || Number.POSITIVE_INFINITY)
		);
	}, [threads, path, filter, currentUser, currentUserId]);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex gap-1 border-b border-[var(--border-subtle)] p-3">
				{(
					[
						"open",
						"resolved",
						"mine",
						...(threads.some((thread) => !thread.isAIDraft && thread.resolutionKnown === false)
							? ["unknown" as const]
							: []),
					] as const
				).map((value) => (
					<button
						key={value === "unknown" ? "Unknown" : value}
						type="button"
						data-filter={value}
						aria-pressed={filter === value}
						disabled={value === "mine" && !currentUser && !currentUserId}
						title={
							value === "mine" && !currentUser && !currentUserId
								? "Current reviewer identity unavailable"
								: undefined
						}
						onClick={() => setFilter(value)}
						className={`rounded-md px-3 py-1 text-[12px] capitalize disabled:opacity-50 ${filter === value ? "bg-[var(--bg-overlay)] text-[var(--text)]" : "text-[var(--text-secondary)]"}`}
					>
						{value}
					</button>
				))}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-3">
				{groups.length === 0 && (
					<p className="p-3 text-[13px] text-[var(--text-tertiary)]">
						No {filter === "mine" ? "matching" : filter} threads.
					</p>
				)}
				{groups.map(([label, group]) => (
					<section key={label} className="mb-4">
						<h3 className="mb-2 text-[12px] font-medium text-[var(--text-tertiary)]">{label}</h3>
						{group.map((thread) => {
							if (thread.isAIDraft) return null;
							const note = path?.threadNotes?.[thread.id];
							return (
								<button
									type="button"
									data-thread-id={thread.id}
									key={thread.id}
									onClick={() => onOpen(thread)}
									className="mb-2 block w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-left text-[12px] hover:bg-[var(--bg-overlay)]"
								>
									<span className="flex items-center gap-2">
										<strong className="truncate font-medium">@{threadAuthor(thread)}</strong>
										<span className="text-[var(--text-tertiary)]">
											{thread.isOutdated
												? `was line ${thread.originalLine ?? thread.line ?? "unknown"}`
												: thread.line == null
													? "File comment"
													: `line ${thread.line}`}
										</span>
										{thread.resolutionKnown === false && (
											<span className="text-[11px] text-[var(--text-tertiary)]">
												Resolution unknown
											</span>
										)}
										{thread.isOutdated && (
											<span className="rounded border border-[var(--tag-amber-border)] px-1 text-[11px] text-[var(--tag-amber-fg)]">
												outdated
											</span>
										)}
									</span>
									<span className="mt-2 block truncate text-[13px] text-[var(--text-secondary)]">
										{threadExcerpt(thread)}
									</span>
									{thread.isOutdated && (
										<span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
											on an earlier version · code has changed since
										</span>
									)}
									<span className="mt-2 block text-[11px] text-[var(--text-tertiary)]">
										{Math.max(0, thread.comments.length - 1)} replies
										{note ? ` · Agent: ${note.verdict}` : ""}
									</span>
								</button>
							);
						})}
					</section>
				))}
			</div>
			<button
				type="button"
				onClick={() => onAsk("Which threads still need a reply?")}
				className="shrink-0 border-t border-[var(--border-subtle)] p-4 text-left text-[12px] text-[var(--accent-hover)]"
			>
				Ask agent which threads still need a reply
			</button>
		</div>
	);
}
