import { create } from "zustand";
import type { ConflictFile } from "../../shared/branch-types";

interface MergeState {
	type: "merge" | "rebase";
	sourceBranch: string;
	targetBranch: string;
	conflicts: ConflictFile[];
	activeFilePath: string | null;
	rebaseProgress: { current: number; total: number } | null;
}

interface BranchStore {
	isPaletteOpen: boolean;
	searchQuery: string;
	selectedIndex: number;
	actionMenuBranch: string | null;
	mergeState: MergeState | null;

	openPalette: () => void;
	closePalette: () => void;
	setSearchQuery: (query: string) => void;
	setSelectedIndex: (index: number) => void;
	openActionMenu: (branch: string) => void;
	closeActionMenu: () => void;
	setMergeState: (state: MergeState | null) => void;
	setActiveConflictFile: (path: string) => void;
	markFileResolved: (path: string) => void;
	clearMergeState: () => void;
}

export const useBranchStore = create<BranchStore>()((set) => ({
	isPaletteOpen: false,
	searchQuery: "",
	selectedIndex: 0,
	actionMenuBranch: null,
	mergeState: null,

	openPalette: () => set({ isPaletteOpen: true }),
	closePalette: () =>
		set({
			isPaletteOpen: false,
			searchQuery: "",
			selectedIndex: 0,
			actionMenuBranch: null,
		}),
	setSearchQuery: (query) => set({ searchQuery: query, selectedIndex: 0 }),
	setSelectedIndex: (index) => set({ selectedIndex: index }),
	openActionMenu: (branch) => set({ actionMenuBranch: branch }),
	closeActionMenu: () => set({ actionMenuBranch: null }),
	setMergeState: (mergeState) => set({ mergeState }),
	setActiveConflictFile: (path) =>
		set((state) => {
			if (!state.mergeState) return state;
			return { mergeState: { ...state.mergeState, activeFilePath: path } };
		}),
	markFileResolved: (path) =>
		set((state) => {
			if (!state.mergeState) return state;
			return {
				mergeState: {
					...state.mergeState,
					conflicts: state.mergeState.conflicts.map((f) =>
						f.path === path ? { ...f, status: "resolved" as const } : f
					),
				},
			};
		}),
	clearMergeState: () => set({ mergeState: null }),
}));
