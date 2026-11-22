import { create } from "zustand";
import type { ActivityQueueTarget } from "../../shared/activity-queue";
import { useTabStore } from "./tab-store";

type TicketTarget = Extract<ActivityQueueTarget, { type: "ticket" }>;
export const useQueueTicketStore = create<{
	destination: { sourceId: string; target: TicketTarget } | null;
	close: () => void;
}>()((set) => ({ destination: null, close: () => set({ destination: null }) }));

/** Navigation only. The caller validates the displayed occurrence before this handoff. */
export function openTicketQueueTarget(sourceId: string, target: TicketTarget): void {
	useQueueTicketStore.setState({ destination: { sourceId, target } });
	useTabStore.getState().setSidebarSegment("tickets");
}
