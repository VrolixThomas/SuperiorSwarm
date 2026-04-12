import { useState } from "react";
import { trpc } from "../trpc/client";
import { useTabStore } from "../stores/tab-store";
import type {
	ChangedFile,
	SolveCommentInfo,
	SolveGroupInfo,
	SolveReplyInfo,
} from "../../shared/solve-types";

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
		const ext = filePath.split(".").pop() ?? "";
		openCommentFixFile(workspaceId, group.id, filePath, group.commitHash, activeWorkspaceCwd, ext);
	};

	return (
		<div
			style={{
				background: "var(--bg-surface)",
				border: `1px solid ${isSolving ? "rgba(76,154,255,0.12)" : "var(--border-subtle)"}`,
				borderRadius: 7,
				marginBottom: 5,
				overflow: "hidden",
				opacity: isReverted ? 0.5 : 1,
			}}
		>
			{/* Header */}
			<div
				onClick={() => !isSolving && setExpanded(!expanded)}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "10px 12px",
					cursor: isSolving ? "default" : "pointer",
					userSelect: "none",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, flex: 1 }}>
					<span
						style={{
							fontSize: 10,
							color: "var(--text-tertiary)",
							width: 14,
							textAlign: "center",
							transform: expanded ? "rotate(90deg)" : "none",
							transition: "transform 0.15s",
						}}
					>
						›
					</span>
					<span
						style={{
							fontSize: 13,
							fontWeight: 500,
							letterSpacing: "-0.015em",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
							textDecoration: isReverted ? "line-through" : "none",
						}}
					>
						{group.label}
					</span>
					<RatioBadge group={group} />
				</div>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexShrink: 0,
						marginLeft: 12,
					}}
				>
					<GroupAction
						group={group}
						onApprove={() => approveMutation.mutate({ groupId: group.id })}
					/>
				</div>
			</div>

			{/* Body */}
			{expanded && !isSolving && !isReverted && (
				<div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px 12px 14px" }}>
					<div
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 10.5,
							color: "var(--text-tertiary)",
							marginBottom: 12,
						}}
					>
						{group.commitHash?.slice(0, 7)}
					</div>
					<ChangedFilesSection files={group.changedFiles} onFileClick={handleFileClick} />
					<CommentsAddressedSection commentsByFile={commentsByFile} sessionId={sessionId} />
				</div>
			)}
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RatioBadge({ group }: { group: SolveGroupInfo }) {
	const fixed = group.comments.filter(
		(c) => c.status === "fixed" || c.status === "wont_fix",
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
			style={{
				flexShrink: 0,
				padding: "1px 7px",
				borderRadius: 100,
				fontFamily: "var(--font-mono)",
				fontSize: 10,
				fontWeight: 500,
				background: bg,
				color,
			}}
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
			<span
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: 11.5,
					color: "var(--accent)",
					fontWeight: 500,
				}}
			>
				<span
					style={{
						width: 6,
						height: 6,
						borderRadius: "50%",
						background: "var(--accent)",
						animation: "blink 1.6s ease-in-out infinite",
					}}
				/>
				Solving
			</span>
		);
	}
	if (group.status === "approved") {
		return (
			<span
				style={{
					padding: "3px 9px",
					borderRadius: 6,
					fontSize: 11,
					fontWeight: 500,
					background: "var(--accent-subtle)",
					color: "var(--accent)",
				}}
			>
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
				style={{
					padding: "4px 12px",
					borderRadius: 6,
					fontSize: 11.5,
					fontWeight: 500,
					background: "var(--success-subtle)",
					color: "var(--success)",
					border: "none",
					cursor: "pointer",
				}}
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
		<div style={{ marginBottom: 14 }}>
			<div
				style={{
					fontSize: 10,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.05em",
					color: "var(--text-tertiary)",
					marginBottom: 5,
				}}
			>
				Changed files
			</div>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 1,
					borderRadius: 5,
					overflow: "hidden",
				}}
			>
				{files.map((file) => (
					<div
						key={file.path}
						onClick={() => onFileClick(file.path)}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "6px 9px",
							background: "var(--bg-elevated)",
							cursor: "pointer",
						}}
					>
						<span style={{ color: "var(--text-tertiary)", fontSize: 11 }}>⬡</span>
						<span
							style={{
								fontFamily: "var(--font-mono)",
								fontSize: 11.5,
								color: "var(--accent)",
								flex: 1,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
							}}
						>
							{file.path}
						</span>
						<span
							style={{
								fontFamily: "var(--font-mono)",
								fontSize: 10,
								color: "var(--text-tertiary)",
								flexShrink: 0,
							}}
						>
							{file.additions > 0 && (
								<span style={{ color: "var(--success)", opacity: 0.7 }}>+{file.additions}</span>
							)}
							{file.additions > 0 && file.deletions > 0 && " "}
							{file.deletions > 0 && (
								<span style={{ color: "var(--danger)", opacity: 0.7 }}>−{file.deletions}</span>
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
}: {
	commentsByFile: Map<string, SolveCommentInfo[]>;
	sessionId: string;
}) {
	if (commentsByFile.size === 0) return null;
	return (
		<div>
			<div
				style={{
					fontSize: 10,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.05em",
					color: "var(--text-tertiary)",
					marginBottom: 6,
				}}
			>
				Comments addressed
			</div>
			{Array.from(commentsByFile.entries()).map(([filePath, comments]) => (
				<div key={filePath} style={{ marginBottom: 10 }}>
					<div
						style={{
							fontFamily: "var(--font-mono)",
							fontSize: 10.5,
							color: "var(--text-tertiary)",
							padding: "4px 0",
							display: "flex",
							alignItems: "center",
							gap: 5,
						}}
					>
						<span style={{ fontSize: 9 }}>⬡</span>
						{filePath.split("/").pop()}
					</div>
					{comments.map((comment) => (
						<CommentItem key={comment.id} comment={comment} sessionId={sessionId} />
					))}
				</div>
			))}
		</div>
	);
}

function CommentItem({
	comment,
	sessionId: _sessionId,
}: {
	comment: SolveCommentInfo;
	sessionId: string;
}) {
	const [showFollowUp, setShowFollowUp] = useState(false);
	const [followUpText, setFollowUpText] = useState("");
	const utils = trpc.useUtils();

	const followUpMutation = trpc.commentSolver.requestFollowUp.useMutation({
		onSuccess: () => {
			setShowFollowUp(false);
			setFollowUpText("");
			utils.commentSolver.invalidate();
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
		<div
			style={{
				padding: "7px 0 7px 14px",
				borderLeft: "1px solid var(--border-default)",
				marginLeft: 4,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
				<div
					style={{
						width: 16,
						height: 16,
						borderRadius: "50%",
						background: "var(--bg-active)",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 8,
						fontWeight: 600,
						color: "var(--text-secondary)",
					}}
				>
					{comment.author.charAt(0).toUpperCase()}
				</div>
				<span style={{ fontSize: 12, fontWeight: 500 }}>{comment.author}</span>
				{comment.lineNumber && (
					<span
						style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-tertiary)" }}
					>
						line {comment.lineNumber}
					</span>
				)}
			</div>
			<div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
				{comment.body}
			</div>
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
				<span style={{ fontSize: 10.5, fontWeight: 500, color: statusColor }}>{statusLabel}</span>
				{(comment.status === "fixed" || comment.status === "unclear") && (
					<button
						onClick={() => setShowFollowUp(!showFollowUp)}
						style={{
							fontSize: 10.5,
							color: "var(--text-tertiary)",
							background: "none",
							border: "none",
							cursor: "pointer",
							textDecoration: "underline",
							textUnderlineOffset: 2,
						}}
					>
						Follow up
					</button>
				)}
			</div>
			{showFollowUp && (
				<div style={{ marginTop: 8 }}>
					<textarea
						value={followUpText}
						onChange={(e) => setFollowUpText(e.target.value)}
						placeholder="What should be changed?"
						style={{
							width: "100%",
							minHeight: 60,
							padding: 8,
							borderRadius: 6,
							border: "1px solid var(--border-default)",
							background: "var(--bg-base)",
							color: "var(--text-primary)",
							fontSize: 12,
							fontFamily: "var(--font-family)",
							resize: "vertical",
						}}
					/>
					<div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
						<button
							onClick={() => {
								setShowFollowUp(false);
								setFollowUpText("");
							}}
							style={{
								padding: "3px 10px",
								borderRadius: 6,
								fontSize: 11,
								background: "transparent",
								color: "var(--text-tertiary)",
								border: "1px solid var(--border-default)",
								cursor: "pointer",
							}}
						>
							Cancel
						</button>
						<button
							onClick={() =>
								followUpMutation.mutate({ commentId: comment.id, followUpText })
							}
							disabled={!followUpText.trim()}
							style={{
								padding: "3px 10px",
								borderRadius: 6,
								fontSize: 11,
								fontWeight: 500,
								background: "var(--accent-subtle)",
								color: "var(--accent)",
								border: "none",
								cursor: followUpText.trim() ? "pointer" : "not-allowed",
								opacity: followUpText.trim() ? 1 : 0.5,
							}}
						>
							Request changes
						</button>
					</div>
				</div>
			)}
			{comment.followUpText && (
				<div
					style={{
						marginTop: 6,
						padding: "6px 10px",
						background: "var(--accent-subtle)",
						borderRadius: 6,
						fontSize: 11.5,
						color: "var(--accent)",
					}}
				>
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
		<div
			style={{
				marginTop: 8,
				padding: "9px 12px",
				background: "var(--bg-base)",
				border: "1px solid var(--border-default)",
				borderRadius: 6,
			}}
		>
			<div
				style={{
					fontSize: 9.5,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.05em",
					color: "var(--warning)",
					marginBottom: 4,
					opacity: 0.75,
				}}
			>
				Draft reply
			</div>
			<div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
				{reply.body}
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					marginTop: 8,
					paddingTop: 8,
					borderTop: "1px solid var(--border-subtle)",
				}}
			>
				<span style={{ fontSize: 11, color: "var(--text-tertiary)", flex: 1 }}>
					Post this reply?
				</span>
				<button
					onClick={() => deleteMutation.mutate({ replyId: reply.id })}
					style={{
						padding: "3px 10px",
						borderRadius: 6,
						fontSize: 11,
						fontWeight: 500,
						background: "transparent",
						color: "var(--text-tertiary)",
						border: "1px solid var(--border-default)",
						cursor: "pointer",
					}}
				>
					Discard
				</button>
				<button
					onClick={() => approveMutation.mutate({ replyId: reply.id })}
					style={{
						padding: "3px 10px",
						borderRadius: 6,
						fontSize: 11,
						fontWeight: 500,
						background: "var(--success-subtle)",
						color: "var(--success)",
						border: "none",
						cursor: "pointer",
					}}
				>
					Approve &amp; post
				</button>
			</div>
		</div>
	);
}
