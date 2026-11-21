import type { ReactNode } from "react";
import type { QueueEntity } from "../../../shared/activity-queue";
import { useWorkspaceQueue } from "../../hooks/useWorkspaceQueue";
import {
	type QueueNavigationSession,
	matchesQueueDestination,
	queueOccurrenceKey,
	queueSessionStatus,
} from "../../lib/queue-navigation-session";
import { usePaneStore } from "../../stores/pane-store";
import { useQueueNavigationStore } from "../../stores/queue-navigation-store";
import { useReviewModeStore } from "../../stores/review-mode-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { QueueCompactActions } from "./QueueCompactActions";
import { queueButton } from "./QueuePanel";

export function QueueBarContent({
	session,
	status,
	next,
	close,
	actions,
}: {
	session: QueueNavigationSession;
	status: ReturnType<typeof queueSessionStatus>;
	next: () => void;
	close: () => void;
	actions: ReactNode;
}) {
	return (
		<section
			aria-label="Queue navigation"
			className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[12px]"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<span className="shrink-0 text-[var(--text-tertiary)]">
					Queue {session.index + 1} of {session.total}
				</span>
				<span className="min-w-0 flex-1 truncate" title={session.item.subject}>
					{status === "cleared"
						? "Cleared"
						: status === "updated"
							? "Updated — choose Next to review the new occurrence"
							: status === "unavailable"
								? "Current activity unavailable"
								: session.item.subject}
				</span>
				{actions}
				<button type="button" className={queueButton} onClick={next}>
					Next ⌘J
				</button>
				<button
					type="button"
					className={queueButton}
					aria-label="End queue navigation"
					onClick={close}
				>
					×
				</button>
				{status === "current" && (
					<p
						className="order-1 w-full truncate text-[11px] text-[var(--text-tertiary)]"
						title={`${session.item.why} · ${session.item.clearsWhen}`}
					>
						{session.item.why} · {session.item.clearsWhen}
					</p>
				)}
			</div>
		</section>
	);
}

export function QueueBar({ entity }: { entity: QueueEntity | null }) {
	const session = useQueueNavigationStore((s) => s.session);
	const query = useWorkspaceQueue();
	const workspaceId = useTabStore((s) => s.activeWorkspaceId);
	const pane = usePaneStore((s) => (workspaceId ? s.getFocusedPane(workspaceId) : null));
	const review = useReviewModeStore((s) => (workspaceId ? s.terminals[workspaceId] : null));
	const reviewActive = useReviewModeStore((s) => s.active);
	const reviewView = useReviewModeStore((s) => s.view);
	const drawerOpen = useReviewModeStore((s) => s.drawerOpen);
	const reviewTerminalVisible =
		reviewActive?.workspaceId === workspaceId && (reviewView === "terminal" || drawerOpen);
	const terminalId = reviewTerminalVisible ? review?.tabId : pane?.activeTabId;
	const sessions = trpc.agentSessions.list.useQuery(undefined, {
		enabled: !!session && !!entity,
		refetchInterval: 2_000,
		staleTime: 0,
	});
	const live = sessions.data?.find(
		(item) => item.workspaceId === entity?.id && item.terminalId === terminalId
	);
	if (
		!session ||
		!entity ||
		sessions.isError ||
		!matchesQueueDestination(session.item, {
			entity,
			terminalId,
			provider: live?.provider,
			providerSessionId: live?.providerSessionId,
		})
	)
		return null;
	const status = queueSessionStatus(
		session,
		query.data?.items ?? [],
		!!query.data && !query.isError && query.data.agentStatusAvailable !== false
	);
	const actions = useQueueNavigationStore.getState();
	return (
		<QueueBarContent
			session={session}
			status={status}
			next={actions.next}
			close={actions.end}
			actions={
				<QueueCompactActions
					key={queueOccurrenceKey(session.item)}
					compact
					item={session.item}
					disabled={status !== "current"}
					refresh={() => query.refetch()}
					onOpen={() => actions.openItem(session.item)}
				/>
			}
		/>
	);
}
