import { create } from "zustand";

export type DiffContext =
	| {
			type: "pr";
			prId: number;
			workspaceSlug: string;
			repoSlug: string;
			repoPath: string;
			title: string;
	  }
	| {
			type: "branch";
			baseBranch: string;
			headBranch: string;
			repoPath: string;
	  }
	| {
			type: "working-tree";
			repoPath: string;
	  };

interface DiffStore {
	activeDiff: DiffContext | null;
	openFile: string | null;
	isPanelOpen: boolean;
	panelSizes: [number, number];
	diffMode: "split" | "inline";
	setActiveDiff: (ctx: DiffContext) => void;
	closeDiff: () => void;
	setOpenFile: (path: string) => void;
	setPanelSizes: (sizes: [number, number]) => void;
	setDiffMode: (mode: "split" | "inline") => void;
	maximizeDiff: () => void;
	maximizeTerminal: () => void;
	restoreSplit: () => void;
}

const DEFAULT_SPLIT: [number, number] = [60, 40];

export const useDiffStore = create<DiffStore>((set, get) => ({
	activeDiff: null,
	openFile: null,
	isPanelOpen: false,
	panelSizes: DEFAULT_SPLIT,
	diffMode: "split",

	setActiveDiff: (ctx) => set({ activeDiff: ctx, isPanelOpen: true }),

	closeDiff: () => set({ activeDiff: null, isPanelOpen: false, openFile: null }),

	setOpenFile: (path) => set({ openFile: path }),

	setPanelSizes: (sizes) => set({ panelSizes: sizes }),

	setDiffMode: (mode) => set({ diffMode: mode }),

	maximizeDiff: () => set({ panelSizes: [100, 0] }),

	maximizeTerminal: () => set({ panelSizes: [0, 100] }),

	restoreSplit: () => {
		const current = get().panelSizes;
		// If already at split, do nothing; otherwise restore default
		if (current[0] !== 0 && current[0] !== 100) return;
		set({ panelSizes: DEFAULT_SPLIT });
	},
}));
