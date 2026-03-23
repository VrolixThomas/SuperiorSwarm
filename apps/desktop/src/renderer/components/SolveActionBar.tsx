import { useState } from "react";
import type { SolveGroupInfo } from "../../shared/solve-types";
import { trpc } from "../trpc/client";

interface SolveActionBarProps {
	sessionId: string;
	groups: SolveGroupInfo[];
	onPushSuccess: () => void;
}

export function SolveActionBar({ sessionId, groups, onPushSuccess }: SolveActionBarProps) {
	const [error, setError] = useState<string | null>(null);
	const pushAndPost = trpc.commentSolver.pushAndPost.useMutation();
	const utils = trpc.useUtils();

	// Count statuses
	const fixedCount = groups.filter((g) => g.status === "fixed").length;
	const approvedCount = groups.filter((g) => g.status === "approved").length;
	const revertedCount = groups.filter((g) => g.status === "reverted").length;
	const pendingCount = groups.filter((g) => g.status === "pending").length;

	// Check if all non-reverted groups are approved
	const nonRevertedGroups = groups.filter((g) => g.status !== "reverted");
	const allGroupsApproved =
		nonRevertedGroups.length > 0 && nonRevertedGroups.every((g) => g.status === "approved");

	// Check if all replies are approved or deleted (no draft replies remain)
	const hasDraftReplies = groups.some((g) =>
		g.comments.some((c) => c.reply && c.reply.status === "draft")
	);

	const canPush = allGroupsApproved && !hasDraftReplies;

	const handlePush = () => {
		setError(null);
		pushAndPost.mutate(
			{ sessionId },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSession.invalidate({ sessionId });
					utils.commentSolver.getSolveSessions.invalidate();
					onPushSuccess();
				},
				onError: (err) => {
					setError(err.message);
				},
			}
		);
	};

	return (
		<div className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
			{/* Error feedback */}
			{error && (
				<div className="border-b border-[var(--border-subtle)] bg-[rgba(255,69,58,0.1)] px-4 py-1.5 text-[10px] text-[#ff453a]">
					{error}
				</div>
			)}

			<div className="flex items-center gap-3 px-4 py-2.5">
				{/* Status summary */}
				<div className="flex flex-1 flex-wrap items-center gap-2 text-[10px]">
					{approvedCount > 0 && <span className="text-[#0a84ff]">{approvedCount} approved</span>}
					{fixedCount > 0 && <span className="text-[#6fdb6f]">{fixedCount} fixed</span>}
					{pendingCount > 0 && (
						<span className="text-[var(--text-tertiary)]">{pendingCount} pending</span>
					)}
					{revertedCount > 0 && <span className="text-[#ff6b6b]">{revertedCount} reverted</span>}
					{hasDraftReplies && <span className="text-[#ffd54f]">draft replies pending</span>}
				</div>

				{/* Push button */}
				<button
					type="button"
					onClick={handlePush}
					disabled={!canPush || pushAndPost.isPending}
					className="shrink-0 rounded-[6px] bg-[var(--accent)] px-4 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					{pushAndPost.isPending ? "Pushing..." : "Push Changes & Post Replies"}
				</button>
			</div>
		</div>
	);
}
