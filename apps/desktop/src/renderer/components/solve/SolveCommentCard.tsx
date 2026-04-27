import { useState } from "react";
import type { SolveCommentInfo } from "../../../shared/solve-types";
import { basename } from "../../lib/format";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { DraftReplySignoff } from "./DraftReplySignoff";

interface Props {
	comment: SolveCommentInfo;
	workspaceId: string;
	variant: "inline" | "sidebar";
	isActive?: boolean;
	onSelect?: () => void;
}

export function SolveCommentCard({ comment, workspaceId, variant, isActive, onSelect }: Props) {
	const [showFollowUp, setShowFollowUp] = useState(false);
	const [followUpText, setFollowUpText] = useState("");
	const utils = trpc.useUtils();

	const [editingReply, setEditingReply] = useState(false);
	const [editReplyText, setEditReplyText] = useState("");

	const updateReplyMutation = trpc.commentSolver.updateReply.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const followUpMutation = trpc.commentSolver.requestFollowUp.useMutation({
		onSuccess: (result) => {
			setShowFollowUp(false);
			setFollowUpText("");
			utils.commentSolver.invalidate();

			if (result.promptPath && result.worktreePath) {
				const tabStore = useTabStore.getState();
				const tabs = tabStore.getTabsByWorkspace(workspaceId);
				const solverTab = tabs.find((t) => t.kind === "terminal" && t.title === "AI Solver");

				if (solverTab) {
					tabStore.setActiveTab(solverTab.id);
					window.electron.terminal
						.write(solverTab.id, `bash '${result.launchScript}'\r`)
						.catch((err: unknown) =>
							console.error("[solve] failed to write follow-up command:", err)
						);
				} else {
					const tabId = tabStore.addTerminalTab(workspaceId, result.worktreePath, "AI Solver");
					window.electron.terminal
						.create(tabId, result.worktreePath)
						.then(() => window.electron.terminal.write(tabId, `bash '${result.launchScript}'\r`))
						.catch((err: unknown) =>
							console.error("[solve] failed to launch follow-up agent:", err)
						);
				}
			}
		},
	});

	const statusColor =
		comment.status === "fixed" || comment.status === "wont_fix"
			? "var(--success)"
			: comment.status === "unclear"
				? "var(--warning)"
				: comment.status === "changes_requested"
					? "var(--accent)"
					: "var(--text-tertiary)";

	const statusLabel =
		comment.status === "fixed"
			? "✓ Fixed"
			: comment.status === "unclear"
				? "? Unclear"
				: comment.status === "changes_requested"
					? "↻ Changes requested"
					: comment.status === "wont_fix"
						? "— Won't fix"
						: "Pending";

	const wrapperClass =
		variant === "inline"
			? [
					"mx-2 my-1 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[11px] shadow-md overflow-hidden border-l-2",
					isActive ? "border-l-[var(--accent)]" : "border-l-[var(--border-subtle)]",
				].join(" ")
			: [
					"w-full border-t border-[var(--border-subtle)] bg-[var(--bg-base)] text-[11px] cursor-pointer hover:bg-[var(--bg-elevated)] border-l-2",
					isActive ? "border-l-[var(--accent)]" : "border-l-transparent",
				].join(" ");

	const lineRef = comment.lineNumber != null ? `line ${comment.lineNumber}` : "file-level";

	return (
		<div
			className={wrapperClass}
			onClick={variant === "sidebar" ? onSelect : undefined}
			data-active={isActive ? "true" : undefined}
		>
			<div className="flex items-center gap-[6px] px-3 py-2">
				<div className="w-[16px] h-[16px] rounded-full bg-[var(--bg-active)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)]">
					{comment.author.charAt(0).toUpperCase()}
				</div>
				<span className="text-[12px] font-medium">{comment.author}</span>
				<span
					className="font-mono text-[10.5px] text-[var(--text-tertiary)]"
					title={`${comment.filePath}${comment.lineNumber != null ? `:${comment.lineNumber}` : " (file-level)"}`}
				>
					{variant === "sidebar" ? `${basename(comment.filePath)} · ${lineRef}` : lineRef}
				</span>
				<span className="ml-auto text-[10.5px] font-medium" style={{ color: statusColor }}>
					{statusLabel}
				</span>
			</div>
			<div className="px-3 pb-2 text-[12px] text-[var(--text-secondary)] leading-[1.55]">
				<MarkdownRenderer content={comment.body} />
			</div>
			<div className="flex items-center gap-[8px] px-3 pb-2">
				{(comment.status === "fixed" || comment.status === "unclear") && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setShowFollowUp(!showFollowUp);
						}}
						className="text-[10.5px] text-[var(--text-tertiary)] bg-transparent border-none cursor-pointer underline underline-offset-2"
					>
						Follow up
					</button>
				)}
			</div>
			{comment.status === "unclear" && (
				<div className="px-3 pb-2 text-[10.5px] text-[var(--text-tertiary)] leading-[1.4]">
					AI couldn't address this — use Follow up above or accept as-is.
				</div>
			)}
			{showFollowUp && (
				<div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
					<textarea
						value={followUpText}
						onChange={(e) => setFollowUpText(e.target.value)}
						placeholder="What should be changed?"
						className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] resize-y"
					/>
					<div className="flex gap-[6px] mt-[6px] justify-end">
						<button
							type="button"
							onClick={() => {
								setShowFollowUp(false);
								setFollowUpText("");
							}}
							className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => followUpMutation.mutate({ commentId: comment.id, followUpText })}
							disabled={!followUpText.trim()}
							className={[
								"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
								followUpText.trim()
									? "cursor-pointer opacity-100"
									: "cursor-not-allowed opacity-50",
							].join(" ")}
						>
							Request changes
						</button>
					</div>
				</div>
			)}
			{comment.followUpText && (
				<div className="mx-3 mb-2 py-[6px] px-[10px] bg-[var(--accent-subtle)] rounded-[6px] text-[11.5px] text-[var(--accent)]">
					Follow-up: {comment.followUpText}
				</div>
			)}
			{comment.reply?.status === "draft" && !editingReply && (
				<div className="px-3 pb-2" onClick={(e) => e.stopPropagation()}>
					<DraftReplySignoff
						reply={comment.reply}
						onEdit={() => {
							setEditingReply(true);
							setEditReplyText(comment.reply?.body ?? "");
						}}
					/>
				</div>
			)}
			{editingReply && comment.reply && (
				<div
					className="mx-3 mb-2 py-[9px] px-[12px] bg-[var(--bg-base)] border border-[var(--accent)] rounded-[6px]"
					onClick={(e) => e.stopPropagation()}
				>
					<div className="text-[9.5px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[4px]">
						Edit reply
					</div>
					<textarea
						value={editReplyText}
						onChange={(e) => setEditReplyText(e.target.value)}
						className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] resize-y"
					/>
					<div className="flex gap-[6px] mt-[6px] justify-end">
						<button
							type="button"
							onClick={() => setEditingReply(false)}
							className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => {
								if (comment.reply) {
									updateReplyMutation.mutate({
										replyId: comment.reply.id,
										body: editReplyText,
									});
								}
								setEditingReply(false);
							}}
							disabled={!editReplyText.trim()}
							className={[
								"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
								editReplyText.trim()
									? "cursor-pointer opacity-100"
									: "cursor-not-allowed opacity-50",
							].join(" ")}
						>
							Save
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
