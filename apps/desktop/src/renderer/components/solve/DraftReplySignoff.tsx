import type { SolveReplyInfo } from "../../../shared/solve-types";
import { trpc } from "../../trpc/client";

export function DraftReplySignoff({
	reply,
	onEdit,
}: {
	reply: SolveReplyInfo;
	onEdit: () => void;
}) {
	const utils = trpc.useUtils();
	const approveMutation = trpc.commentSolver.approveReply.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});
	const deleteMutation = trpc.commentSolver.deleteReply.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	return (
		<div className="mt-[8px] py-[9px] px-[12px] bg-[var(--bg-base)] border border-[var(--border-default)] rounded-[6px]">
			<div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[var(--warning)] mb-[4px] opacity-75">
				Draft reply
			</div>
			<div className="text-[12px] text-[var(--text-secondary)] leading-[1.5]">{reply.body}</div>
			<div className="flex items-center gap-[6px] mt-[8px] pt-[8px] border-t border-[var(--border-subtle)]">
				<span className="text-[11px] text-[var(--text-tertiary)] flex-1">Post this reply?</span>
				<button
					type="button"
					onClick={onEdit}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
				>
					Edit
				</button>
				<button
					type="button"
					onClick={() => deleteMutation.mutate({ replyId: reply.id })}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
				>
					Discard
				</button>
				<button
					type="button"
					onClick={() => approveMutation.mutate({ replyId: reply.id })}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
				>
					Approve &amp; post
				</button>
			</div>
		</div>
	);
}
