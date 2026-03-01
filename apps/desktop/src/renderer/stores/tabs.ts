import { create } from "zustand";
import type { DiffContext } from "./diff";

// Omit that distributes over union members, preserving discriminant narrowing
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let _nextId = 0;
function nextId(): string {
	return `file-tab-${++_nextId}`;
}

export type FileTab =
	| {
			id: string;
			type: "diff-file";
			diffCtx: DiffContext;
			filePath: string;
			title: string;
			language: string;
	  }
	| {
			id: string;
			type: "file";
			repoPath: string;
			filePath: string;
			title: string;
			language: string;
	  };

export type ActivePane = { kind: "terminal" } | { kind: "file"; tabId: string };

interface TabsStore {
	fileTabs: FileTab[];
	activePane: ActivePane;
	openFileTab: (tab: DistributiveOmit<FileTab, "id">) => string;
	closeFileTab: (id: string) => void;
	closeAllDiffTabs: (repoPath: string) => void;
	setActivePane: (pane: ActivePane) => void;
}

function tabKey(tab: DistributiveOmit<FileTab, "id">): string {
	if (tab.type === "diff-file") return `diff-file:${tab.diffCtx.repoPath}:${tab.filePath}`;
	return `file:${tab.repoPath}:${tab.filePath}`;
}

export const useTabsStore = create<TabsStore>((set, get) => ({
	fileTabs: [],
	activePane: { kind: "terminal" },

	openFileTab: (tabData) => {
		const key = tabKey(tabData);
		const existing = get().fileTabs.find((t) => tabKey(t) === key);
		if (existing) {
			set({ activePane: { kind: "file", tabId: existing.id } });
			return existing.id;
		}
		const id = nextId();
		const tab = { ...tabData, id } as FileTab;
		set((s) => ({ fileTabs: [...s.fileTabs, tab], activePane: { kind: "file", tabId: id } }));
		return id;
	},

	closeFileTab: (id) => {
		set((s) => {
			const idx = s.fileTabs.findIndex((t) => t.id === id);
			const remaining = s.fileTabs.filter((t) => t.id !== id);
			let newPane: ActivePane;
			if (s.activePane.kind === "file" && s.activePane.tabId === id) {
				const next = remaining[idx] ?? remaining[idx - 1];
				newPane = next ? { kind: "file", tabId: next.id } : { kind: "terminal" };
			} else {
				newPane = s.activePane;
			}
			return { fileTabs: remaining, activePane: newPane };
		});
	},

	closeAllDiffTabs: (repoPath) => {
		set((s) => {
			const remaining = s.fileTabs.filter(
				(t) => !(t.type === "diff-file" && t.diffCtx.repoPath === repoPath),
			);
			let newPane = s.activePane;
			const activePaneFileId = s.activePane.kind === "file" ? s.activePane.tabId : null;
			if (activePaneFileId !== null && !remaining.find((t) => t.id === activePaneFileId)) {
				const any = remaining[0];
				newPane = any ? { kind: "file", tabId: any.id } : { kind: "terminal" };
			}
			return { fileTabs: remaining, activePane: newPane };
		});
	},

	setActivePane: (pane) => set({ activePane: pane }),
}));
