import { useQueueNavigation } from "../../hooks/useQueueNavigation";
import { useActivityQueueStore } from "../../stores/activity-queue-store";
import { useProjectStore } from "../../stores/projects";
import { useQueueNavigationStore } from "../../stores/queue-navigation-store";
import { QueueCompactActions } from "./QueueCompactActions";
import { queueButton } from "./QueuePanel";
import { QueuePeek } from "./QueuePeek";

/** Mounted once beside the command palette, independent of the current route. */
export function QueueNavigationRuntime() {
	const { query, open, busy, message, clearMessage } = useQueueNavigation();
	const peek = useQueueNavigationStore((s) => s.peekOpen);
	const entity = useQueueNavigationStore((s) => s.peekEntity);
	return (
		<>
			{peek && (
				<QueuePeek
					key={entity ? `${entity.kind}:${entity.id}` : "all"}
					items={query.data?.items ?? []}
					available={!!query.data && !query.isError}
					entity={entity}
					close={() => useQueueNavigationStore.getState().closePeek()}
					shouldRestoreFocus={() => useQueueNavigationStore.getState().restorePeekFocus}
					open={(item) => void open(item)}
					openQueue={(item) => {
						useQueueNavigationStore.getState().closePeek(false);
						useProjectStore.getState().closeSettings();
						useActivityQueueStore.setState({ selectedWorkspaceItemId: item?.id ?? null });
						useActivityQueueStore.getState().show();
					}}
					actions={(item, disabled) => (
						<QueueCompactActions
							key={JSON.stringify([item.id, item.revision, item.members])}
							item={item}
							disabled={disabled || busy}
							refresh={() => query.refetch()}
							onOpen={() => void open(item)}
						/>
					)}
				/>
			)}
			{message && (
				<output className="fixed bottom-5 left-1/2 z-[110] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[12px] text-[var(--text)] shadow-lg">
					{message}
					<button type="button" className={queueButton} onClick={clearMessage}>
						Dismiss
					</button>
				</output>
			)}
		</>
	);
}
