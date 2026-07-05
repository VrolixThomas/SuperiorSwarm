import { type ReactNode, useCallback, useEffect, useState } from "react";
import type {
	AIDraftThread,
	GitHubReviewThread,
	UnifiedThread,
} from "../../../../shared/github-types";
import { threadAuthor, threadDate } from "../../../lib/pr-review-threads";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { ReplyComposer } from "./ReplyComposer";
import { ThreadActions } from "./ThreadActions";
import { ThreadStatusChip } from "./ThreadStatusChip";

export interface ThreadCallbacks {
	onAccept?: (draftCommentId: string) => void;
	onDecline?: (draftCommentId: string) => void;
	onDelete?: (draftCommentId: string) => void;
	onSaveEdit?: (draftCommentId: string, body: string) => void;
	onReply?: (threadId: string, body: string) => void;
	onResolve?: (threadId: string) => void;
	onOpenInChanges?: (path: string, threadId: string) => void;
}

interface ThreadCardProps {
	thread: UnifiedThread;
	variant: "inline" | "full";
	active?: boolean;
	callbacks: ThreadCallbacks;
	contextSlot?: ReactNode;
	defaultCollapsed?: boolean;
	onCollapsedChange?: (collapsed: boolean) => void;
}

type GitHubThread = GitHubReviewThread & { isAIDraft?: false };

function splitThread(thread: UnifiedThread): {
	aiThread: AIDraftThread | null;
	githubThread: GitHubThread | null;
} {
	if (thread.isAIDraft) {
		return { aiThread: thread, githubThread: null };
	}

	return { aiThread: null, githubThread: thread };
}

function fileLabel(path: string, line: number | null): string {
	return line == null ? path : `${path}:${line}`;
}

function hasActions(thread: UnifiedThread, callbacks: ThreadCallbacks): boolean {
	if (callbacks.onOpenInChanges) return true;

	if (thread.isAIDraft) {
		const canAccept = thread.status === "pending" || thread.status === "edited";
		const canEdit =
			thread.status === "pending" || thread.status === "edited" || thread.status === "user-pending";
		const canDecline = canEdit;

		return (
			(canAccept && Boolean(callbacks.onAccept)) ||
			(canEdit && Boolean(callbacks.onSaveEdit)) ||
			(canDecline && Boolean(callbacks.onDecline)) ||
			(thread.status === "error" && Boolean(callbacks.onDelete))
		);
	}

	return !thread.isResolved && (Boolean(callbacks.onReply) || Boolean(callbacks.onResolve));
}

function relativeDate(iso: string): string {
	if (!iso) return "";

	const timestamp = new Date(iso).getTime();
	if (Number.isNaN(timestamp)) return "";

	const minutes = Math.round((Date.now() - timestamp) / 60_000);
	if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.round(hours / 24);
	if (days < 30) return `${days}d ago`;

	return new Date(iso).toLocaleDateString();
}

function FileLineLink({
	thread,
	onOpenInChanges,
}: {
	thread: UnifiedThread;
	onOpenInChanges?: (path: string, threadId: string) => void;
}) {
	const label = fileLabel(thread.path, thread.line);

	if (!onOpenInChanges) {
		return (
			<span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
				{label}
			</span>
		);
	}

	return (
		<button
			type="button"
			title={thread.path}
			onClick={(event) => {
				event.stopPropagation();
				onOpenInChanges(thread.path, thread.id);
			}}
			className="min-w-0 truncate font-mono text-[11px] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:text-[var(--accent)]"
		>
			{label}
		</button>
	);
}

function CollapsedThread({
	thread,
	active,
	onExpand,
}: {
	thread: GitHubReviewThread & { isAIDraft?: false };
	active: boolean;
	onExpand: () => void;
}) {
	const label = fileLabel(thread.path, thread.line);
	const author = threadAuthor(thread);

	return (
		<button
			type="button"
			aria-label={`Expand resolved thread by ${author} in ${label}`}
			onMouseDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				event.stopPropagation();
				onExpand();
			}}
			className={[
				"flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--bg-surface)] px-3 py-1.5 text-left text-[12px] transition-colors duration-[120ms]",
				active ? "border-[var(--accent)]" : "border-[var(--border-subtle)]",
				"text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]",
			].join(" ")}
		>
			<span className="shrink-0 rounded-[4px] bg-[var(--success-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-success)]">
				Resolved
			</span>
			<span className="min-w-0 truncate">{author}</span>
			<span className="shrink-0">&middot;</span>
			<span className="min-w-0 truncate font-mono text-[11px]">{label}</span>
			<span className="ml-auto shrink-0 text-[11px] text-[var(--text-tertiary)]">Expand</span>
		</button>
	);
}

export function ThreadCard({
	thread,
	variant,
	active = false,
	callbacks,
	contextSlot,
	defaultCollapsed = true,
	onCollapsedChange,
}: ThreadCardProps) {
	const { aiThread, githubThread } = splitThread(thread);
	const isAIDraft = aiThread !== null;
	const isInlineResolvedGitHub =
		variant === "inline" && githubThread !== null && githubThread.isResolved;
	const [composer, setComposer] = useState<"reply" | "edit" | null>(null);
	const [collapsed, setCollapsed] = useState(isInlineResolvedGitHub ? defaultCollapsed : false);
	const intent = useReviewModeStore((state) => state.intent);
	const clearIntent = useReviewModeStore((state) => state.clearIntent);
	const paddingClassName = variant === "full" ? "px-4" : "px-3";
	const bodyPaddingClassName = variant === "full" ? "px-4 py-3" : "px-3 py-2.5";
	const dateLabel = relativeDate(threadDate(thread));
	const showActions = hasActions(thread, callbacks);
	const updateCollapsed = useCallback(
		(nextCollapsed: boolean) => {
			setCollapsed(nextCollapsed);
			if (isInlineResolvedGitHub) onCollapsedChange?.(nextCollapsed);
		},
		[isInlineResolvedGitHub, onCollapsedChange]
	);

	useEffect(() => {
		setCollapsed(isInlineResolvedGitHub ? defaultCollapsed : false);
	}, [defaultCollapsed, isInlineResolvedGitHub]);

	useEffect(() => {
		if (!intent || intent.threadId !== thread.id) return;

		if (intent.kind === "reply" && !isAIDraft) {
			updateCollapsed(false);
			setComposer("reply");
		} else if (intent.kind === "edit" && isAIDraft) {
			setComposer("edit");
		}

		clearIntent();
	}, [clearIntent, intent, isAIDraft, thread.id, updateCollapsed]);

	if (collapsed && githubThread !== null) {
		return (
			<CollapsedThread
				thread={githubThread}
				active={active}
				onExpand={() => updateCollapsed(false)}
			/>
		);
	}

	return (
		<div
			data-thread-id={thread.id}
			onMouseDown={(event) => event.stopPropagation()}
			className={[
				"overflow-hidden rounded-[var(--radius-md)] border bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]",
				active ? "border-[var(--accent)]" : "border-[var(--border-subtle)]",
			].join(" ")}
		>
			<div
				className={`flex min-w-0 items-center gap-2 border-b border-[var(--border-subtle)] py-2 ${paddingClassName}`}
			>
				{isAIDraft ? (
					<span className="ai-badge shrink-0">AI</span>
				) : (
					<span className="min-w-0 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						{threadAuthor(thread)}
					</span>
				)}

				<FileLineLink thread={thread} onOpenInChanges={callbacks.onOpenInChanges} />

				{aiThread !== null && aiThread.roundNumber != null && aiThread.roundNumber > 1 && (
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">
						Round {aiThread.roundNumber}
					</span>
				)}

				<div className="min-w-2 flex-1" />
				<ThreadStatusChip thread={thread} />
				{dateLabel && (
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">{dateLabel}</span>
				)}
				{isInlineResolvedGitHub && (
					<button
						type="button"
						aria-label="Collapse resolved thread"
						onClick={(event) => {
							event.stopPropagation();
							updateCollapsed(true);
						}}
						className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					>
						Collapse
					</button>
				)}
			</div>

			{variant === "full" && contextSlot}

			{aiThread !== null ? (
				<div className={bodyPaddingClassName}>
					<MarkdownRenderer content={aiThread.userEdit ?? aiThread.body} />
				</div>
			) : (
				<div>
					{githubThread?.comments.map((comment, index) => (
						<div
							key={comment.id}
							className={[
								bodyPaddingClassName,
								index > 0 ? "ml-4 border-l border-[var(--border-subtle)]" : "",
								index < githubThread.comments.length - 1
									? "border-b border-[var(--border-subtle)]"
									: "",
							].join(" ")}
						>
							{index > 0 && (
								<div className="mb-1 flex min-w-0 items-center gap-2 text-[12px]">
									<span className="min-w-0 truncate font-medium text-[var(--text-secondary)]">
										{comment.author}
									</span>
									<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">
										{relativeDate(comment.createdAt)}
									</span>
								</div>
							)}
							<MarkdownRenderer content={comment.body} />
						</div>
					))}
				</div>
			)}

			{showActions && (
				<div className={`border-t border-[var(--border-subtle)] py-1.5 ${paddingClassName}`}>
					<ThreadActions
						thread={thread}
						callbacks={callbacks}
						onStartReply={() => setComposer("reply")}
						onStartEdit={() => setComposer("edit")}
						showOpenInChanges={variant === "full"}
					/>
				</div>
			)}

			{composer === "edit" && aiThread !== null && (
				<div className={`border-t border-[var(--border-subtle)] pb-3 pt-2 ${paddingClassName}`}>
					<ReplyComposer
						placeholder="Edit comment"
						ariaLabel="Edit comment"
						submitLabel="Save"
						initialValue={aiThread.userEdit ?? aiThread.body}
						autoFocus
						onSubmit={(body) => {
							callbacks.onSaveEdit?.(aiThread.draftCommentId, body);
							setComposer(null);
						}}
						onCancel={() => setComposer(null)}
					/>
				</div>
			)}

			{composer === "reply" && githubThread !== null && (
				<div className={`border-t border-[var(--border-subtle)] pb-3 pt-2 ${paddingClassName}`}>
					<ReplyComposer
						placeholder="Reply..."
						ariaLabel="Reply to thread"
						submitLabel="Reply"
						autoFocus
						onSubmit={(body) => {
							callbacks.onReply?.(githubThread.id, body);
							setComposer(null);
						}}
						onCancel={() => setComposer(null)}
					/>
				</div>
			)}
		</div>
	);
}
