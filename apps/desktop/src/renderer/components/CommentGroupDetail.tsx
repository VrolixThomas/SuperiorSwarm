import { useEffect, useRef, useState } from "react";
import type { SolveCommentInfo, SolveGroupInfo } from "../../shared/solve-types";
import { trpc } from "../trpc/client";

interface CommentGroupDetailProps {
	group: SolveGroupInfo;
	sessionId: string;
	onRevert: () => void;
	canRevert: boolean;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	fixed: { bg: "#2d5a2d", text: "#6fdb6f", label: "Fixed" },
	approved: { bg: "rgba(10,132,255,0.15)", text: "#0a84ff", label: "Approved" },
	reverted: { bg: "rgba(220,50,50,0.15)", text: "#ff6b6b", label: "Reverted" },
	pending: { bg: "var(--bg-overlay)", text: "var(--text-tertiary)", label: "Pending" },
};

const COMMENT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	open: { bg: "var(--bg-overlay)", text: "var(--text-tertiary)", label: "Open" },
	fixed: { bg: "#2d5a2d", text: "#6fdb6f", label: "Fixed" },
	unclear: { bg: "#8a6d2b", text: "#ffd54f", label: "Unclear" },
	wont_fix: { bg: "rgba(220,50,50,0.15)", text: "#ff6b6b", label: "Won't Fix" },
};

function ReplyEditor({
	comment,
	sessionId,
}: {
	comment: SolveCommentInfo;
	sessionId: string;
}) {
	const reply = comment.reply;
	const [editBody, setEditBody] = useState(reply?.body ?? "");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const utils = trpc.useUtils();

	useEffect(() => {
		setEditBody(reply?.body ?? "");
	}, [reply?.body]);

	const invalidateSession = () => {
		utils.commentSolver.getSolveSession.invalidate({ sessionId });
	};

	const updateReply = trpc.commentSolver.updateReply.useMutation({
		onSuccess: invalidateSession,
	});

	const deleteReply = trpc.commentSolver.deleteReply.useMutation({
		onSuccess: invalidateSession,
	});

	if (!reply) return null;

	const isDraft = reply.status === "draft";
	const isApproved = reply.status === "approved";

	return (
		<div className="mt-2 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)]">
			{/* Reply header */}
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="text-[10px] font-medium text-[var(--text-tertiary)]">Draft Reply</span>
				<div className="flex-1" />
				{isApproved && (
					<span className="rounded-[3px] bg-[rgba(10,132,255,0.15)] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-[#0a84ff]">
						Approved
					</span>
				)}
			</div>

			{/* Editable body */}
			<div className="p-2">
				<textarea
					ref={textareaRef}
					value={editBody}
					onChange={(e) => setEditBody(e.target.value)}
					rows={3}
					disabled={isApproved}
					className={[
						"w-full resize-none rounded-[4px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] placeholder-[var(--text-quaternary)] outline-none focus:border-[var(--accent)]",
						isApproved ? "opacity-60" : "",
					].join(" ")}
				/>
			</div>

			{/* Actions */}
			{isDraft && (
				<div className="flex gap-1.5 border-t border-[var(--border-subtle)] px-3 py-1.5">
					<button
						type="button"
						onClick={() => {
							updateReply.mutate({
								replyId: reply.id,
								body: editBody,
								status: "approved",
							});
						}}
						disabled={updateReply.isPending}
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] font-medium bg-[rgba(48,209,88,0.15)] text-[#30d158] hover:opacity-80 disabled:opacity-50"
					>
						{updateReply.isPending ? "Saving..." : "Approve Reply"}
					</button>
					<button
						type="button"
						onClick={() => {
							deleteReply.mutate({ replyId: reply.id });
						}}
						disabled={deleteReply.isPending}
						className="rounded-[4px] px-2.5 py-0.5 text-[10px] bg-[var(--bg-overlay)] text-[var(--text-tertiary)] hover:opacity-80 disabled:opacity-50"
					>
						Delete Reply
					</button>
				</div>
			)}
		</div>
	);
}

function CommentCard({
	comment,
	sessionId,
}: {
	comment: SolveCommentInfo;
	sessionId: string;
}) {
	const commentStatus = COMMENT_STATUS_STYLES[comment.status] ?? COMMENT_STATUS_STYLES.open;
	const filename = comment.filePath.split("/").pop() ?? comment.filePath;

	return (
		<div className="overflow-hidden rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
			{/* Comment header */}
			<div className="flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
				<span className="text-[10px] font-medium text-[var(--text-secondary)]">
					{comment.author}
				</span>
				<span
					className="font-mono text-[10px] text-[var(--text-quaternary)]"
					title={comment.filePath}
				>
					{filename}
					{comment.lineNumber != null && `:${comment.lineNumber}`}
				</span>
				<div className="flex-1" />
				<span
					className="shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
					style={{
						backgroundColor: commentStatus.bg,
						color: commentStatus.text,
					}}
				>
					{commentStatus.label}
				</span>
			</div>

			{/* Comment body */}
			<div className="px-3 py-2 text-[11px] text-[var(--text-tertiary)] whitespace-pre-wrap">
				{comment.body}
			</div>

			{/* Reply editor (for unclear comments with draft replies) */}
			{comment.reply && (
				<div className="px-3 pb-2">
					<ReplyEditor comment={comment} sessionId={sessionId} />
				</div>
			)}
		</div>
	);
}

export function CommentGroupDetail({
	group,
	sessionId,
	onRevert,
	canRevert,
}: CommentGroupDetailProps) {
	const statusStyle = STATUS_STYLES[group.status] ?? STATUS_STYLES.pending;
	const shortHash = group.commitHash ? group.commitHash.slice(0, 7) : null;
	const revertGroup = trpc.commentSolver.revertGroup.useMutation();
	const approveGroup = trpc.commentSolver.approveGroup.useMutation();
	const utils = trpc.useUtils();

	const handleRevert = () => {
		revertGroup.mutate(
			{ groupId: group.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSession.invalidate({ sessionId });
					onRevert();
				},
			}
		);
	};

	const handleApprove = () => {
		approveGroup.mutate(
			{ groupId: group.id },
			{
				onSuccess: () => {
					utils.commentSolver.getSolveSession.invalidate({ sessionId });
				},
			}
		);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden">
			{/* Detail header */}
			<div className="shrink-0 border-b border-[var(--border)] px-4 py-3">
				<div className="flex items-center gap-2">
					<h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text)]">
						{group.label}
					</h2>
					<span
						className="shrink-0 rounded-[3px] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
						style={{
							backgroundColor: statusStyle.bg,
							color: statusStyle.text,
						}}
					>
						{statusStyle.label}
					</span>
				</div>
				{shortHash && (
					<div className="mt-1 flex items-center gap-1.5">
						<span className="text-[10px] text-[var(--text-quaternary)]">Commit:</span>
						<span
							className="text-[11px] text-[var(--text-tertiary)]"
							style={{ fontFamily: "var(--font-mono)" }}
						>
							{shortHash}
						</span>
					</div>
				)}
			</div>

			{/* Comments list */}
			<div className="flex-1 overflow-y-auto px-4 py-3">
				<div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
					Comments ({group.comments.length})
				</div>
				<div className="flex flex-col gap-2.5">
					{group.comments.map((comment) => (
						<CommentCard key={comment.id} comment={comment} sessionId={sessionId} />
					))}
					{group.comments.length === 0 && (
						<div className="py-4 text-center text-[12px] text-[var(--text-quaternary)]">
							No comments in this group
						</div>
					)}
				</div>
			</div>

			{/* Action buttons */}
			<div className="flex shrink-0 items-center gap-2 border-t border-[var(--border)] px-4 py-2.5">
				{group.status === "fixed" && (
					<button
						type="button"
						onClick={handleApprove}
						disabled={approveGroup.isPending}
						className="rounded-[6px] border border-[rgba(48,209,88,0.15)] bg-[rgba(48,209,88,0.12)] px-3 py-1 text-[11px] font-medium text-[#30d158] transition-colors hover:bg-[rgba(48,209,88,0.2)] disabled:opacity-50"
					>
						{approveGroup.isPending ? "Approving..." : "Approve Fix"}
					</button>
				)}
				{(group.status === "fixed" || group.status === "approved") && (
					<button
						type="button"
						onClick={handleRevert}
						disabled={!canRevert || revertGroup.isPending}
						title={!canRevert ? "Revert later groups first" : "Revert this fix commit"}
						className="rounded-[6px] border border-[rgba(220,50,50,0.15)] bg-[rgba(220,50,50,0.1)] px-3 py-1 text-[11px] font-medium text-[#ff6b6b] transition-colors hover:bg-[rgba(220,50,50,0.15)] disabled:opacity-30"
					>
						{revertGroup.isPending ? "Reverting..." : "Revert"}
					</button>
				)}
			</div>
		</div>
	);
}
