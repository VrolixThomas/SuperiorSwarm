import type { ReactNode } from "react";
import type { UnifiedThread } from "../../../../shared/github-types";
import type { ThreadCallbacks } from "./ThreadCard";

interface GhostButtonProps {
	label: string;
	tone?: "default" | "success" | "danger";
	onClick: () => void;
}

function GhostButton({ label, tone = "default", onClick }: GhostButtonProps) {
	const toneClassName =
		tone === "success"
			? "text-[var(--color-success)] hover:bg-[var(--success-subtle)]"
			: tone === "danger"
				? "text-[var(--color-danger)] hover:bg-[var(--danger-subtle)]"
				: "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]";

	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={`rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium transition-colors duration-[120ms] ${toneClassName}`}
		>
			{label}
		</button>
	);
}

interface ThreadActionsProps {
	thread: UnifiedThread;
	callbacks: ThreadCallbacks;
	onStartReply: () => void;
	onStartEdit: () => void;
	showOpenInChanges?: boolean;
}

export function ThreadActions({
	thread,
	callbacks,
	onStartReply,
	onStartEdit,
	showOpenInChanges = false,
}: ThreadActionsProps) {
	const buttons: ReactNode[] = [];

	if (thread.isAIDraft) {
		const canAccept = thread.status === "pending" || thread.status === "edited";
		const canEdit =
			thread.status === "pending" ||
			thread.status === "edited" ||
			thread.status === "user-pending" ||
			thread.status === "approved";
		const canDecline = canEdit;

		if (canAccept && callbacks.onAccept) {
			buttons.push(
				<GhostButton
					key="accept"
					label="Accept"
					tone="success"
					onClick={() => callbacks.onAccept?.(thread.draftCommentId)}
				/>
			);
		}

		if (canEdit && callbacks.onSaveEdit) {
			buttons.push(<GhostButton key="edit" label="Edit" onClick={onStartEdit} />);
		}

		if (canDecline && callbacks.onDecline) {
			buttons.push(
				<GhostButton
					key="decline"
					label="Decline"
					onClick={() => callbacks.onDecline?.(thread.draftCommentId)}
				/>
			);
		}

		if (thread.status === "error" && callbacks.onDelete) {
			buttons.push(
				<GhostButton
					key="remove"
					label="Remove"
					tone="danger"
					onClick={() => callbacks.onDelete?.(thread.draftCommentId)}
				/>
			);
		}
	} else if (!thread.isResolved) {
		if (callbacks.onReply) {
			buttons.push(<GhostButton key="reply" label="Reply" onClick={onStartReply} />);
		}

		if (callbacks.onResolve) {
			buttons.push(
				<GhostButton
					key="resolve"
					label="Resolve"
					onClick={() => callbacks.onResolve?.(thread.id)}
				/>
			);
		}
	}

	if (showOpenInChanges && callbacks.onOpenInChanges) {
		buttons.push(
			<GhostButton
				key="open-in-code"
				label="Open in code"
				onClick={() => callbacks.onOpenInChanges?.(thread.path, thread.id)}
			/>
		);
	}

	if (buttons.length === 0) return null;

	return <div className="flex flex-wrap items-center gap-1">{buttons}</div>;
}
