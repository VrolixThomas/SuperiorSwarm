import { create } from "zustand";

export interface TerminalTab {
	id: string;
	workspaceId: string;
	title: string;
	cwd: string;
}

interface TerminalStore {
	tabs: TerminalTab[];
	activeTabId: string | null;
	activeWorkspaceId: string | null;
	activeWorkspaceCwd: string;

	// Workspace selection
	setActiveWorkspace: (workspaceId: string, cwd: string) => void;

	// Tab management (always bound to a workspace)
	addTab: (workspaceId: string, cwd: string, title?: string) => string;
	removeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	updateTabTitle: (id: string, title: string) => void;

	// Queries
	getTabsByWorkspace: (workspaceId: string) => TerminalTab[];
	getVisibleTabs: () => TerminalTab[];

	// Session restore
	hydrate: (
		sessions: Array<{ id: string; workspaceId: string; title: string; cwd: string }>,
		activeTabId: string | null,
		activeWorkspaceId: string | null,
		activeWorkspaceCwd: string
	) => void;
}

let counter = 0;

export const useTerminalStore = create<TerminalStore>((set, get) => ({
	tabs: [],
	activeTabId: null,
	activeWorkspaceId: null,
	activeWorkspaceCwd: "",

	setActiveWorkspace: (workspaceId, cwd) => {
		const state = get();
		const wsTabs = state.tabs.filter((t) => t.workspaceId === workspaceId);
		set({
			activeWorkspaceId: workspaceId,
			activeWorkspaceCwd: cwd,
			activeTabId: wsTabs.find((t) => t.id === state.activeTabId)?.id ?? wsTabs[0]?.id ?? null,
		});
	},

	addTab: (workspaceId, cwd, title) => {
		const id = `terminal-${++counter}`;
		const tabTitle = title ?? `Terminal ${counter}`;
		set((state) => ({
			tabs: [...state.tabs, { id, workspaceId, title: tabTitle, cwd }],
			activeTabId: id,
		}));
		return id;
	},

	removeTab: (id) => {
		set((state) => {
			const filtered = state.tabs.filter((t) => t.id !== id);
			let nextActive = state.activeTabId;
			if (state.activeTabId === id) {
				const closedTab = state.tabs.find((t) => t.id === id);
				const wsTabs = closedTab
					? filtered.filter((t) => t.workspaceId === closedTab.workspaceId)
					: filtered;
				const idx = state.tabs.findIndex((t) => t.id === id);
				nextActive = wsTabs[Math.min(idx, wsTabs.length - 1)]?.id ?? null;
			}
			return { tabs: filtered, activeTabId: nextActive };
		});
	},

	setActiveTab: (id) => set({ activeTabId: id }),

	updateTabTitle: (id, title) =>
		set((state) => ({
			tabs: state.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
		})),

	getTabsByWorkspace: (workspaceId) => {
		return get().tabs.filter((t) => t.workspaceId === workspaceId);
	},

	getVisibleTabs: () => {
		const state = get();
		if (!state.activeWorkspaceId) return [];
		return state.tabs.filter((t) => t.workspaceId === state.activeWorkspaceId);
	},

	hydrate: (sessions, activeTab, activeWs, activeCwd) => {
		const maxId = sessions.reduce((max, s) => {
			const match = s.id.match(/^terminal-(\d+)$/);
			return match ? Math.max(max, Number(match[1])) : max;
		}, 0);
		counter = maxId;

		set({
			tabs: sessions.map((s) => ({
				id: s.id,
				workspaceId: s.workspaceId,
				title: s.title,
				cwd: s.cwd,
			})),
			activeTabId: activeTab,
			activeWorkspaceId: activeWs,
			activeWorkspaceCwd: activeCwd,
		});
	},
}));
