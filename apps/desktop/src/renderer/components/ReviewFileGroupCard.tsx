import { useState } from "react";
import type { FileGroupItem } from "../../shared/github-types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ReviewFileGroupCardProps {
	filePath: string;
	items: FileGroupItem[];
	defaultExpanded: boolean;
	onApprove: (commentId: string) => void;
	onReject: (commentId: string) => void;
	onEdit: (commentId: string, newBody: string) => void;
	onApproveAll: (commentIds: string[]) => void;
	onOpenInDiff: (filePath: string) => void;
	onReplyToThread?: (threadId: string, body: string) => void;
	onResolveThread?: (threadId: string) => void;
}

export function ReviewFileGroupCard({
	filePath,
	items,
	defaultExpanded,
	onApprove,
	onReject,
	onEdit,
	onApproveAll,
	onOpenInDiff,
	onReplyToThread,
	onResolveThread,
}: ReviewFileGroupCardProps) {
	const aiDrafts = items.filter((i) => i.kind === "ai-draft");
	const nonRejected = aiDrafts.filter((c) => c.status !== "rejected");
	const allApproved = nonRejected.length > 0 && nonRejected.every((c) => c.status === "approved");
	const [expanded, setExpanded] = useState(allApproved ? false : defaultExpanded);

	const approvedCount = nonRejected.filter((c) => c.status === "approved").length;
	const pendingIds = nonRejected
		.filter((c) => c.status !== "approved" && c.status !== "edited")
		.map((c) => c.id);
	const visibleItems = items.filter((item) =>
		item.kind === "ai-draft" ? item.status !== "rejected" : true,
	);
	const totalItemCount = visibleItems.length;

	return (
		<div
			className={[
				"bg-[var(--bg-surface)] rounded-[7px] mb-[5px] overflow-hidden border border-[var(--border-subtle)]",
				allApproved ? "opacity-60" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			{/* Header */}
			<div
				onClick={() => setExpanded(!expanded)}
				className="flex items-center justify-between px-[12px] py-[10px] select-none cursor-pointer"
			>
				<div className="flex items-center gap-[7px] min-w-0 flex-1">
					<span
						className="text-[10px] text-[var(--text-tertiary)] w-[14px] text-center transition-transform duration-[150ms]"
						style={{ transform: expanded ? "rotate(90deg)" : "none" }}
					>
						›
					</span>
					<span
						onClick={(e) => {
							e.stopPropagation();
							onOpenInDiff(filePath);
						}}
						className="[font-family:var(--font-mono)] text-[11.5px] text-[var(--accent)] cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis hover:underline"
					>
						{filePath}
					</span>
					<span className="shrink-0 py-[1px] px-[7px] rounded-full font-mono text-[10px] font-medium bg-[var(--bg-active)] text-[var(--text-tertiary)]">
						{totalItemCount}
					</span>
					{approvedCount > 0 && (
						<span className="shrink-0 py-[1px] px-[7px] rounded-full text-[10px] font-medium bg-[var(--success-subtle)] text-[var(--success)]">
							{approvedCount} approved
						</span>
					)}
				</div>
				<div className="flex items-center gap-[6px] shrink-0 ml-[12px]">
					{pendingIds.length > 0 && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onApproveAll(pendingIds);
							}}
							className="py-[3px] px-[9px] rounded-[6px] text-[11px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
						>
							Approve All
						</button>
					)}
				</div>
			</div>

			{/* Body */}
			{expanded && (
				<div className="border-t border-[var(--border-subtle)] px-[12px] pt-[10px] pb-[12px]">
					{visibleItems.map((item) =>
							item.kind === "ai-draft" ? (
								<CommentRow
									key={item.id}
									comment={item}
									onApprove={onApprove}
									onReject={onReject}
									onEdit={onEdit}
									onOpenInDiff={() => onOpenInDiff(filePath)}
								/>
							) : (
								<GitHubThreadRow
									key={item.id}
									item={item}
									onReply={onReplyToThread}
									onResolve={onResolveThread}
								/>
							),
						)}
				</div>
			)}
		</div>
	);
}

// ── Sub-components ────────────────────────────────────────────────────────────

const DELTA_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	resolved: {
		bg: "var(--success-subtle)",
		text: "var(--success)",
		label: "RESOLVED",
	},
	new: {
		bg: "var(--warning-subtle)",
		text: "var(--warning)",
		label: "NEW",
	},
	still_open: {
		bg: "rgba(249,115,22,0.12)",
		text: "rgb(249,115,22)",
		label: "STILL OPEN",
	},
	regressed: {
		bg: "var(--danger-subtle)",
		text: "var(--danger)",
		label: "REGRESSED",
	},
};

function CommentRow({
	comment,
	onApprove,
	onReject,
	onEdit,
	onOpenInDiff,
}: {
	comment: {
		id: string;
		lineNumber: number | null;
		body: string;
		status: string;
		userEdit: string | null;
		roundDelta: "new" | "resolved" | "still_open" | "regressed" | null;
	};
	onApprove: (id: string) => void;
	onReject: (id: string) => void;
	onEdit: (id: string, newBody: string) => void;
	onOpenInDiff: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState(comment.userEdit ?? comment.body);

	const isApproved = comment.status === "approved";
	const isEdited = comment.status === "edited";
	const delta = comment.roundDelta ? DELTA_STYLES[comment.roundDelta] : null;

	return (
		<div
			className={[
				"py-[8px] border-b border-[var(--border-subtle)] last:border-b-0",
				isApproved ? "opacity-70" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div className="flex items-start gap-[8px]">
				{/* Line number */}
				<div className="shrink-0 w-[40px]">
					{comment.lineNumber != null && (
						<span className="[font-family:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]">
							L{comment.lineNumber}
						</span>
					)}
				</div>

				{/* Comment body */}
				<div className="flex-1 min-w-0">
					{!editing && (
						<div className="text-[12px] text-[var(--text-secondary)] leading-[1.55]">
							<MarkdownRenderer content={comment.userEdit ?? comment.body} />
						</div>
					)}
					{editing && (
						<div className="mt-[2px]">
							<textarea
								value={editText}
								onChange={(e) => setEditText(e.target.value)}
								className="w-full min-h-[60px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] font-[var(--font-family)] resize-y"
							/>
							<div className="flex gap-[6px] mt-[6px] justify-end">
								<button
									type="button"
									onClick={() => {
										setEditing(false);
										setEditText(comment.userEdit ?? comment.body);
									}}
									className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => {
										onEdit(comment.id, editText);
										setEditing(false);
									}}
									disabled={!editText.trim()}
									className={[
										"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
										editText.trim()
											? "cursor-pointer opacity-100"
											: "cursor-not-allowed opacity-50",
									].join(" ")}
								>
									Save
								</button>
							</div>
						</div>
					)}

					{/* Delta badge + actions */}
					<div className="flex items-center gap-[6px] mt-[5px]">
						{delta && (
							<span
								className="py-[1px] px-[7px] rounded-full text-[10px] font-medium"
								style={{ background: delta.bg, color: delta.text }}
							>
								{delta.label}
							</span>
						)}

						{isApproved && (
							<span className="text-[10.5px] font-medium text-[var(--success)]">✓ Approved</span>
						)}

						{isEdited && !editing && (
							<span className="text-[10.5px] font-medium text-[var(--accent)]">Edited</span>
						)}

						{!isApproved && !isEdited && !editing && (
							<div className="flex items-center gap-[4px]">
								<button
									type="button"
									onClick={() => onApprove(comment.id)}
									className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium bg-[var(--success-subtle)] text-[var(--success)] border-none cursor-pointer"
								>
									Approve
								</button>
								<button
									type="button"
									onClick={() => {
										setEditing(true);
										setEditText(comment.userEdit ?? comment.body);
									}}
									className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
								>
									Edit
								</button>
								<button
									type="button"
									onClick={() => onReject(comment.id)}
									className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
								>
									Reject
								</button>
								<button
									type="button"
									onClick={onOpenInDiff}
									className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
								>
									View in Diff →
								</button>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function GitHubThreadRow({
	item,
	onReply,
	onResolve,
}: {
	item: Extract<FileGroupItem, { kind: "github-thread" }>;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
}) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [replyBody, setReplyBody] = useState("");

	return (
		<div
			className={[
				"py-[8px] border-b border-[var(--border-subtle)] last:border-b-0",
				item.isResolved ? "opacity-50" : "",
			]
				.filter(Boolean)
				.join(" ")}
		>
			<div className="flex items-start gap-[8px]">
				{/* Line number */}
				<div className="shrink-0 w-[40px]">
					{item.lineNumber != null && (
						<span className="[font-family:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]">
							L{item.lineNumber}
						</span>
					)}
				</div>

				{/* Thread body */}
				<div className="flex-1 min-w-0">
					{item.comments.map((c) => (
						<div key={c.id} className="mb-[6px] last:mb-0">
							<div className="flex items-center gap-[4px] mb-[2px]">
								<span className="text-[10.5px] font-medium text-[var(--text-secondary)]">
									{c.author}
								</span>
							</div>
							<div className="text-[12px] text-[var(--text-secondary)] leading-[1.55]">
								<MarkdownRenderer content={c.body} />
							</div>
						</div>
					))}

					{/* Actions */}
					<div className="flex items-center gap-[4px] mt-[5px]">
						{item.isResolved ? (
							<span className="text-[10.5px] font-medium text-[var(--success)]">Resolved</span>
						) : (
							<>
								{onResolve && (
									<button
										type="button"
										onClick={() => onResolve(item.id)}
										className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
									>
										Resolve
									</button>
								)}
								{onReply && !replyOpen && (
									<button
										type="button"
										onClick={() => setReplyOpen(true)}
										className="py-[2px] px-[8px] rounded-[5px] text-[10.5px] font-medium text-[var(--text-tertiary)] bg-transparent border border-[var(--border-default)] cursor-pointer"
									>
										Reply
									</button>
								)}
							</>
						)}
					</div>

					{/* Reply input */}
					{replyOpen && (
						<div className="mt-[6px]">
							<textarea
								value={replyBody}
								onChange={(e) => setReplyBody(e.target.value)}
								placeholder="Write a reply..."
								className="w-full min-h-[50px] p-[8px] rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-base)] text-[var(--text-primary)] text-[12px] font-[var(--font-family)] resize-y"
							/>
							<div className="flex gap-[6px] mt-[4px] justify-end">
								<button
									type="button"
									onClick={() => {
										setReplyOpen(false);
										setReplyBody("");
									}}
									className="py-[3px] px-[10px] rounded-[6px] text-[11px] bg-transparent text-[var(--text-tertiary)] border border-[var(--border-default)] cursor-pointer"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={() => {
										if (replyBody.trim() && onReply) {
											onReply(item.id, replyBody.trim());
											setReplyBody("");
											setReplyOpen(false);
										}
									}}
									disabled={!replyBody.trim()}
									className={[
										"py-[3px] px-[10px] rounded-[6px] text-[11px] font-medium bg-[var(--accent-subtle)] text-[var(--accent)] border-none",
										replyBody.trim()
											? "cursor-pointer opacity-100"
											: "cursor-not-allowed opacity-50",
									].join(" ")}
								>
									Reply
								</button>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
