import { create } from "zustand";
import type { QueueEntity, WorkspaceQueueItem } from "../../shared/activity-queue";
import {
	type QueueNavigationSession,
	bindQueueSession,
	pendingQueueItems,
	queueOccurrenceKey,
} from "../lib/queue-navigation-session";

export const useQueueNavigationStore = create<{
	session: QueueNavigationSession | null;
	peekOpen: boolean;
	peekEntity: QueueEntity | null;
	restorePeekFocus: boolean;
	jumpRequest: number;
	requestedItem: WorkspaceQueueItem | null;
	select: (item: WorkspaceQueueItem, items: readonly WorkspaceQueueItem[]) => void;
	end: () => void;
	next: () => void;
	openItem: (item: WorkspaceQueueItem) => void;
	peek: (entity?: QueueEntity) => void;
	closePeek: (restoreFocus?: boolean) => void;
}>()((set) => ({
	session: null,
	peekOpen: false,
	peekEntity: null,
	restorePeekFocus: true,
	jumpRequest: 0,
	requestedItem: null,
	select: (item, items) =>
		set({
			session: pendingQueueItems(items).some(
				(row) => queueOccurrenceKey(row) === queueOccurrenceKey(item)
			)
				? bindQueueSession(item, items)
				: null,
		}),
	end: () => set({ session: null }),
	next: () => set((state) => ({ jumpRequest: state.jumpRequest + 1, requestedItem: null })),
	openItem: (item) =>
		set((state) => ({ jumpRequest: state.jumpRequest + 1, requestedItem: structuredClone(item) })),
	peek: (entity) => set({ peekOpen: true, peekEntity: entity ?? null, restorePeekFocus: true }),
	closePeek: (restoreFocus = true) =>
		set({ peekOpen: false, peekEntity: null, restorePeekFocus: restoreFocus }),
}));
