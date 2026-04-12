import { useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type {
	ChangedFile,
	SolveCommentInfo,
	SolveGroupInfo,
	SolveReplyInfo,
} from "../../shared/solve-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { MarkdownRenderer } from "./MarkdownRenderer";

// Inject blink animation once
if (typeof document !== "undefined" && !document.querySelector("[data-solve-animations]")) {
	const style = document.createElement("style");
	style.setAttribute("data-solve-animations", "");
	style.textContent = "@keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }";
	document.head.appendChild(style);
}

interface Props {
	group: SolveGroupInfo;
	sessionId: string;
	workspaceId: string;
	defaultExpanded: boolean;
}

export function SolveCommitGroupCard({ group, sessionId, workspaceId, defaultExpanded }: Props) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const utils = trpc.useUtils();
	const activeWorkspaceCwd = useTabStore((s) => s.activeWorkspaceCwd);
	const openCommentFixFile = useTabStore((s) => s.openCommentFixFile);

	const approveMutation = trpc.commentSolver.approveGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const isSolving = group.status === "pending";
	const isReverted = group.status === "reverted";
	const draftReplyCount = group.comments.filter((c) => c.reply?.status === "draft").length;

	// Group comments by file
	const commentsByFile = new Map<string, SolveCommentInfo[]>();
	for (const comment of group.comments) {
		const existing = commentsByFile.get(comment.filePath) ?? [];
		existing.push(comment);
		commentsByFile.set(comment.filePath, existing);
	}

	const handleFileClick = (filePath: string) => {
		if (!group.commitHash) return;
		if (!activeWorkspaceCwd) return;
		openCommentFixFile(
			workspaceId,
			group.id,
			filePath,
			group.commitHash,
			activeWorkspaceCwd,
			detectLanguage(filePath)
		);
	};

	return (
		<div
			className={[
				"bg-[var(--bg-surface)] rounded-[7px] mb-[5px] overflow-hidden",
				isSolving
					? "border border-[rgba(76,154,255,0.12)]"
					: "border border-[var(--border-subtle)]",
				isReverted ? "opacity-50" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			{/* Header */}
			<div
				onClick={() => !isSolving && setExpanded(!expanded)}
				className={[
					"flex items-center justify-between px-[12px] py-[10px] select-none",
					isSolving ? "cursor-default" : "cursor-pointer",
				].join(" ")}
			>
				<div className="flex items-center gap-[7px] min-w-0 flex-1">
					<span
						className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
						style={{ transform: expanded ? "rotate(90deg)" : "none" }}
					>
						›
					</span>
					<span
						className={[
							"text-[13px] font-medium tracking-[-0.015em] whitespace-nowrap overflow-hidden text-ellipsis",
							isReverted ? "line-through" : "",
						]
							.filter(Boolean)
							.join(" ")}
					>
						{group.label}
					</span>
					<RatioBadge group={group} />
					{draftReplyCount > 0 && (
						<span className="shrink-0 py-[1px] px-[7px] rounded-full text-[10px] font-medium bg-[var(--warning-subtle)] text-[var(--warning)]">
							✉ {draftReplyCount} draft
						</span>
					)}
				</div>
				<div className="flex items-center gap-[6px] shrink-0 ml-[12px]">
					<GroupAction
						group={group}
						onApprove={() => approveMutation.mutate({ groupId: group.id })}
					/>
				</div>
			</div>

			{/* Body */}
			{expanded && !isSolving && !isReverted && (
				<div className="border-t border-[var(--border-subtle)] px-[12px] pt-[12px] pb-[14px]">
					<div className="font-mono text-[10.5px] text-[var(--text-tertiary)] mb-[12px]">
						{group.commitHash?.slice(0, 7)}
					</div>
					<ChangedFilesSection files={group.changedFiles} onFileClick={handleFileClick} />
					<CommentsAddressedSection
						commentsByFile={commentsByFile}
						sessionId={sessionId}
						workspaceId={workspaceId}
					/>
				</div>
			)}
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RatioBadge({ group }: { group: SolveGroupInfo }) {
	const fixed = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix"
	).length;
	const total = group.comments.length;
	const hasUnclear = group.comments.some((c) => c.status === "unclear");

	const bg =
		total === 0
			? "var(--bg-active)"
			: fixed === total
				? "var(--success-subtle)"
				: hasUnclear
					? "var(--warning-subtle)"
					: "var(--bg-active)";
	const color =
		total === 0
			? "var(--text-tertiary)"
			: fixed === total
				? "var(--success)"
				: hasUnclear
					? "var(--warning)"
					: "var(--text-tertiary)";

	return (
		<span
			className="shrink-0 py-[1px] px-[7px] rounded-full font-mono text-[10px] font-medium"
			style={{ background: bg, color }}
		>
			{fixed}/{total}
		</span>
	);
}

function GroupAction({
	group,
	onApprove,
}: {
	group: SolveGroupInfo;
	onApprove: () => void;
}) {
	if (group.status === "pending") {
		return (
			<span className="flex items-center gap-[6px] text-[11.5px] text-[var(--accent)] font-medium">
				<span
					className="w-[6px] h-[6px] rounded-full bg-[var(--accent)]"
					style={{ animation: "blink 1.6s ease-in-out infinite" }}
				/>
				Solving
			</span>
		);
	}
	if (group.status === "approved") {
		return (
			<span className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)]">
				✓ Approved
			</span>
		);
	}
	if (group.status === "fixed") {
		return (
			<button
				onClick={(e) => {
					e.stopPropagation();
					onApprove();
				}}
				className="py-[4px] px-[12px] rounded-[6px] text-[11.5px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
			>
				Approve
			</button>
		);
	}
	return null;
}

function ChangedFilesSection({
	files,
	onFileClick,
}: {
	files: ChangedFile[];
	onFileClick: (path: string) => void;
}) {
	if (files.length === 0) return null;
	return (
		<div className="mb-[14px]">
			<div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[5px]">
				Changed files
			</div>
			<div className="flex flex-col gap-[1px] rounded-[5px] overflow-hidden">
				{files.map((file) => (
					<div
						key={file.path}
						onClick={() => onFileClick(file.path)}
						className="flex items-center gap-[8px] py-[6px] px-[9px] bg-[var(--bg-elevated)] cursor-pointer"
					>
						<span className="text-[var(--text-tertiary)] text-[11px]">⬡</span>
						<span className="font-mono text-[11.5px] text-[var(--accent)] flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
							{file.path}
						</span>
						<span className="font-mono text-[10px] text-[var(--text-tertiary)] shrink-0">
							{file.additions > 0 && (
								<span className="text-[var(--success)] opacity-70">+{file.additions}</span>
							)}
							{file.additions > 0 && file.deletions > 0 && " "}
							{file.deletions > 0 && (
								<span className="text-[var(--danger)] opacity-70">−{file.deletions}</span>
							)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

function CommentsAddressedSection({
	commentsByFile,
	sessionId,
	workspaceId,
}: {
	commentsByFile: Map<string, SolveCommentInfo[]>;
	sessionId: string;
	workspaceId: string;
}) {
	if (commentsByFile.size === 0) return null;
	return (
		<div>
			<div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-tertiary)] mb-[6px]">
				Comments addressed
			</div>
			{Array.from(commentsByFile.entries()).map(([filePath, comments]) => (
				<div key={filePath} className="mb-[10px]">
					<div className="font-mono text-[10.5px] text-[var(--text-tertiary)] py-[4px] flex items-center gap-[5px]">
						<span className="text-[9px]">⬡</span>
						{filePath.split("/").pop()}
					</div>
					{comments.map((comment) => (
						<CommentItem key={comment.id} comment={comment} workspaceId={workspaceId} />
					))}
				</div>
			))}
		</div>
	);
}

function CommentItem({
	comment,
	workspaceId,
}: {
	comment: SolveCommentInfo;
	workspaceId: string;
}) {
	const [showFollowUp, setShowFollowUp] = useState(false);
	const [followUpText, setFollowUpText] = useState("");
	const utils = trpc.useUtils();

	const followUpMutation = trpc.commentSolver.requestFollowUp.useMutation({
		onSuccess: (result) => {
			setShowFollowUp(false);
			setFollowUpText("");
			utils.commentSolver.invalidate();

			// Launch the agent with the follow-up prompt
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

	return (
		<div className="py-[7px] pl-[14px] border-l border-[var(--border-default)] ml-[4px]">
			<div className="flex items-center gap-[6px] mb-[3px]">
				<div className="w-[16px] h-[16px] rounded-full bg-[var(--bg-active)] flex items-center justify-center text-[8px] font-semibold text-[var(--text-secondary)]">
					{comment.author.charAt(0).toUpperCase()}
				</div>
				<span className="text-[12px] font-medium">{comment.author}</span>
				{comment.lineNumber && (
					<span className="font-mono text-[10.5px] text-[var(--text-tertiary)]">
						line {comment.lineNumber}
					</span>
				)}
			</div>
			<div className="text-[12px] text-[var(--text-secondary)] leading-[1.55]">
				<MarkdownRenderer content={comment.body} />
			</div>
			<div className="flex items-center gap-[8px] mt-[5px]">
				<span className="text-[10.5px] font-medium" style={{ color: statusColor }}>
					{statusLabel}
				</span>
				{(comment.status === "fixed" || comment.status === "unclear") && (
					<button
						onClick={() => setShowFollowUp(!showFollowUp)}
						className="text-[10.5px] text-[var(--text-tertiary)] bg-transparent border-none cursor-pointer underline underline-offset-2"
					>
						Follow up
					</button>
				)}
			</div>
			{comment.status === "unclear" && (
				<div className="text-[10.5px] text-[var(--text-tertiary)] mt-[3px] leading-[1.4]">
					AI couldn't address this — use Follow up above or accept as-is.
				</div>
			)}
			{showFollowUp && (
				<div className="mt-[8px]">
					<textarea
						value={followUpText}
						onChange={(e) => setFollowUpText(e.target.value)}
						placeholder="What should be changed?"
						className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] font-[var(--font-family)] resize-y"
					/>
					<div className="flex gap-[6px] mt-[6px] justify-end">
						<button
							onClick={() => {
								setShowFollowUp(false);
								setFollowUpText("");
							}}
							className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
						>
							Cancel
						</button>
						<button
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
				<div className="mt-[6px] py-[6px] px-[10px] bg-[var(--accent-subtle)] rounded-[6px] text-[11.5px] text-[var(--accent)]">
					Follow-up: {comment.followUpText}
				</div>
			)}
			{/* Draft reply sign-off */}
			{comment.reply?.status === "draft" && <DraftReplySignoff reply={comment.reply} />}
		</div>
	);
}

function DraftReplySignoff({ reply }: { reply: SolveReplyInfo }) {
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
					onClick={() => deleteMutation.mutate({ replyId: reply.id })}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
				>
					Discard
				</button>
				<button
					onClick={() => approveMutation.mutate({ replyId: reply.id })}
					className="py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
				>
					Approve &amp; post
				</button>
			</div>
		</div>
	);
}
