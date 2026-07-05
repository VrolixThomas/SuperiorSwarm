import { create } from "zustand";

export type SearchTab = "all" | "files" | "symbols" | "text";

export const SEARCH_TABS: SearchTab[] = ["all", "files", "symbols", "text"];

interface SearchEverywhereStore {
	isOpen: boolean;
	activeTab: SearchTab;
	open: () => void;
	close: () => void;
	toggle: () => void;
	setActiveTab: (tab: SearchTab) => void;
	cycleTab: (delta: 1 | -1) => void;
}

export const useSearchEverywhereStore = create<SearchEverywhereStore>()((set, get) => ({
	isOpen: false,
	activeTab: "all",

	open: () => set({ isOpen: true, activeTab: "all" }),
	close: () => set({ isOpen: false }),
	toggle: () => (get().isOpen ? get().close() : get().open()),
	setActiveTab: (tab) => set({ activeTab: tab }),
	cycleTab: (delta) => {
		const idx = SEARCH_TABS.indexOf(get().activeTab);
		const next = SEARCH_TABS[(idx + delta + SEARCH_TABS.length) % SEARCH_TABS.length];
		if (next) set({ activeTab: next });
	},
}));
