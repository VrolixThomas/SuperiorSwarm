import { create } from "zustand";
import { useTabStore } from "./tab-store";

export const useActivityQueueStore = create<{
	open: boolean;
	pendingCount: number | null;
	unavailable: boolean;
	selectedWorkspaceItemId: string | null;
	setSummary: (pendingCount: number | null, unavailable: boolean) => void;
	show: () => void;
	close: () => void;
	toggle: () => void;
}>()((set) => ({
	open: false,
	pendingCount: null,
	unavailable: false,
	selectedWorkspaceItemId: null,
	setSummary: (pendingCount, unavailable) =>
		set((state) =>
			state.pendingCount === pendingCount && state.unavailable === unavailable
				? state
				: { pendingCount, unavailable }
		),
	show: () => {
		useTabStore.getState().setSidebarSegment("queue");
		set({ open: true });
	},
	close: () => set({ open: false }),
	toggle: () =>
		set((state) => {
			if (!state.open) useTabStore.getState().setSidebarSegment("queue");
			return { open: !state.open };
		}),
}));
