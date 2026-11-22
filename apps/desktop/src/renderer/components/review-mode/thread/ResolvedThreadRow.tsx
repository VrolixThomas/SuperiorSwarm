import { useState } from "react";
import type { GitHubReviewThread } from "../../../../shared/github-types";
import { type ThreadCallbacks, ThreadCard } from "./ThreadCard";

export function ResolvedThreadRow({
	thread,
	callbacks,
	active = false,
}: { thread: GitHubReviewThread; callbacks: ThreadCallbacks; active?: boolean }) {
	const [expanded, setExpanded] = useState(false);
	if (expanded || active)
		return (
			<ThreadCard
				thread={thread}
				variant="inline"
				callbacks={callbacks}
				defaultCollapsed={false}
				active={active}
			/>
		);
	return (
		<button
			type="button"
			onClick={() => setExpanded(true)}
			className="mx-2 my-1 block max-w-full truncate rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-left text-[12px] text-[var(--text-tertiary)]"
		>
			✓ Resolved · @{thread.comments[0]?.author ?? "reviewer"}: {thread.comments[0]?.body} ·{" "}
			{Math.max(0, thread.comments.length - 1)} replies
		</button>
	);
}
