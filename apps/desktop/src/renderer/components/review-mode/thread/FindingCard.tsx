import { useState } from "react";
import type { AIDraftThread } from "../../../../shared/github-types";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { ReplyComposer } from "./ReplyComposer";
import type { ThreadCallbacks } from "./ThreadCard";

interface FindingCardProps {
	thread: AIDraftThread;
	callbacks: ThreadCallbacks;
	agentLabel?: string;
	index?: number;
	total?: number;
	onAsk?: () => void;
}

export function FindingCard({
	thread,
	callbacks,
	agentLabel = "Review agent",
	index = 1,
	total = 1,
	onAsk,
}: FindingCardProps) {
	const [editing, setEditing] = useState(false);
	return (
		<article
			data-thread-id={thread.id}
			className="mx-2 my-1 overflow-hidden rounded-lg border border-[var(--tag-amber-border)] bg-[var(--bg-surface)] text-[13px]"
		>
			<header className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
				<span
					aria-hidden="true"
					className="rounded bg-[var(--bg-overlay)] px-1 text-[var(--text-secondary)]"
				>
					♧
				</span>
				<strong className="font-medium">{agentLabel}</strong>
				{thread.category && (
					<span className="rounded border border-[var(--tag-amber-border)] px-1.5 py-0.5 text-[11px] text-[var(--tag-amber-fg)]">
						{thread.category}
					</span>
				)}
				<span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
					{index} of {total}
				</span>
			</header>
			<div className="p-3">
				<MarkdownRenderer content={thread.userEdit ?? thread.body} skipHtml />
			</div>
			<div className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-3 py-2 text-[12px]">
				{callbacks.onAccept && (
					<button
						type="button"
						onClick={() => callbacks.onAccept?.(thread.draftCommentId)}
						className="rounded-md bg-[var(--accent)] px-2 py-1 text-[var(--accent-foreground)]"
					>
						Accept
					</button>
				)}
				{callbacks.onSaveEdit && (
					<button
						type="button"
						onClick={() => setEditing(true)}
						className="text-[var(--text-secondary)]"
					>
						Edit
					</button>
				)}
				{callbacks.onDecline && (
					<button
						type="button"
						onClick={() => callbacks.onDecline?.(thread.draftCommentId)}
						className="text-[var(--text-secondary)]"
					>
						Dismiss
					</button>
				)}
				{onAsk && (
					<button type="button" onClick={onAsk} className="ml-auto text-[var(--accent-hover)]">
						Ask about this
					</button>
				)}
			</div>
			{editing && callbacks.onSaveEdit && (
				<div className="border-t border-[var(--border-subtle)] p-3">
					<ReplyComposer
						placeholder="Edit finding"
						initialValue={thread.userEdit ?? thread.body}
						autoFocus
						submitLabel="Save"
						onSubmit={(body) => {
							callbacks.onSaveEdit?.(thread.draftCommentId, body, thread.status);
							setEditing(false);
						}}
						onCancel={() => setEditing(false)}
					/>
				</div>
			)}
		</article>
	);
}
