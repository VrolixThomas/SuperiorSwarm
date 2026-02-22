import { create } from "zustand";

export interface TerminalTab {
	id: string;
	title: string;
}

interface TerminalStore {
	tabs: TerminalTab[];
	activeTabId: string | null;
	addTab: () => string;
	removeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	updateTabTitle: (id: string, title: string) => void;
}

let counter = 0;

export const useTerminalStore = create<TerminalStore>((set) => ({
	tabs: [],
	activeTabId: null,

	addTab: () => {
		const id = `terminal-${++counter}`;
		set((state) => ({
			tabs: [...state.tabs, { id, title: `Terminal ${counter}` }],
			activeTabId: id,
		}));
		return id;
	},

	removeTab: (id) => {
		set((state) => {
			const filtered = state.tabs.filter((t) => t.id !== id);
			let nextActive = state.activeTabId;
			if (state.activeTabId === id) {
				const idx = state.tabs.findIndex((t) => t.id === id);
				nextActive = filtered[Math.min(idx, filtered.length - 1)]?.id ?? null;
			}
			return { tabs: filtered, activeTabId: nextActive };
		});
	},

	setActiveTab: (id) => set({ activeTabId: id }),

	updateTabTitle: (id, title) =>
		set((state) => ({
			tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
		})),
}));
