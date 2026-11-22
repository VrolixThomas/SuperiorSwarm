import { type ReactNode, useCallback, useState } from "react";
import type { UnifiedThread } from "../../../../shared/github-types";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { type ThreadCallbacks, ThreadCard } from "../thread/ThreadCard";
interface CollapseCommand {
	defaultCollapsed: boolean;
	nonce: number;
}

function resolvedInlineCollapsed(
	thread: UnifiedThread,
	defaultCollapsed: boolean,
	overrides: Map<string, boolean>
): boolean {
	if (thread.isAIDraft) return false;
	if (!thread.isResolved) return false;
	return overrides.get(thread.id) ?? defaultCollapsed;
}

export function useStepThreadRenderer(
	sessionKey: string,
	activeThreadId: string | null,
	callbacks: ThreadCallbacks,
	renderThreadOverride?: (thread: UnifiedThread) => ReactNode
) {
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const [collapseCommand, setCollapseCommand] = useState<CollapseCommand>({
		defaultCollapsed: true,
		nonce: 0,
	});
	const [collapsedThreadOverrides, setCollapsedThreadOverrides] = useState<Map<string, boolean>>(
		() => new Map()
	);
	const handleInlineCollapsedChange = useCallback(
		(threadId: string, collapsed: boolean) => {
			setCollapsedThreadOverrides((current) => {
				const next = new Map(current);
				if (collapsed === collapseCommand.defaultCollapsed) {
					next.delete(threadId);
				} else {
					next.set(threadId, collapsed);
				}
				return next;
			});
		},
		[collapseCommand.defaultCollapsed]
	);

	const renderThread = useCallback(
		(thread: UnifiedThread) => {
			const defaultCollapsed =
				thread.id === activeThreadId
					? false
					: resolvedInlineCollapsed(
							thread,
							collapseCommand.defaultCollapsed,
							collapsedThreadOverrides
						);

			return (
				<div
					data-review-thread-id={thread.id}
					onPointerDownCapture={() => selectThread(sessionKey, thread.id)}
					onFocusCapture={() => selectThread(sessionKey, thread.id)}
				>
					{renderThreadOverride ? (
						renderThreadOverride(thread)
					) : (
						<ThreadCard
							key={`${thread.id}-${collapseCommand.nonce}`}
							thread={thread}
							variant="inline"
							active={thread.id === activeThreadId}
							callbacks={callbacks}
							defaultCollapsed={defaultCollapsed}
							onCollapsedChange={(collapsed) => handleInlineCollapsedChange(thread.id, collapsed)}
						/>
					)}
				</div>
			);
		},
		[
			renderThreadOverride,
			activeThreadId,
			callbacks,
			collapseCommand.defaultCollapsed,
			collapseCommand.nonce,
			collapsedThreadOverrides,
			handleInlineCollapsedChange,
			selectThread,
			sessionKey,
		]
	);
	return { renderThread, collapseCommand, setCollapseCommand, setCollapsedThreadOverrides };
}
