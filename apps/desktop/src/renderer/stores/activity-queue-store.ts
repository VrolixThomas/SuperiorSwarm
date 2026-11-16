import { create } from "zustand";

export const useActivityQueueStore = create<{
	open: boolean;
	pendingCount: number | null;
	unavailable: boolean;
	setSummary: (pendingCount: number | null, unavailable: boolean) => void;
	show: () => void;
	close: () => void;
	toggle: () => void;
}>()((set) => ({
	open: false,
	pendingCount: null,
	unavailable: false,
	setSummary: (pendingCount, unavailable) =>
		set((state) =>
			state.pendingCount === pendingCount && state.unavailable === unavailable
				? state
				: { pendingCount, unavailable }
		),
	show: () => set({ open: true }),
	close: () => set({ open: false }),
	toggle: () => set((state) => ({ open: !state.open })),
}));
