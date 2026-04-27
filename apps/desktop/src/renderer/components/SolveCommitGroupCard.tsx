import { useState } from "react";
import { detectLanguage } from "../../shared/diff-types";
import type { ChangedFile, SolveCommentInfo, SolveGroupInfo } from "../../shared/solve-types";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { GroupAction } from "./solve/GroupAction";
import { RatioBadge } from "./solve/RatioBadge";
import { SolveCommentWidget } from "./solve/SolveCommentWidget";

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

	const pushMutation = trpc.commentSolver.pushGroup.useMutation({
		onSuccess: () => utils.commentSolver.invalidate(),
	});

	const revokeMutation = trpc.commentSolver.revokeGroup.useMutation({
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
						onRevoke={() => revokeMutation.mutate({ groupId: group.id })}
						onPush={() => pushMutation.mutate({ groupId: group.id })}
						isPushing={pushMutation.isPending}
					/>
				</div>
			</div>

			{/* Body */}
			{expanded && !isSolving && !isReverted && (
				<div className="border-t border-[var(--border-subtle)] px-[12px] pt-[12px] pb-[14px]">
					<div className="font-mono text-[10.5px] text-[var(--text-tertiary)] mb-[12px]">
						{group.commitHash ? group.commitHash.slice(0, 7) : "no code changes"}
					</div>
					<ChangedFilesSection files={group.changedFiles} onFileClick={handleFileClick} />
					<CommentsAddressedSection
						commentsByFile={commentsByFile}
						workspaceId={workspaceId}
					/>
				</div>
			)}
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
	workspaceId,
}: {
	commentsByFile: Map<string, SolveCommentInfo[]>;
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
						<SolveCommentWidget key={comment.id} comment={comment} workspaceId={workspaceId} />
					))}
				</div>
			))}
		</div>
	);
}
