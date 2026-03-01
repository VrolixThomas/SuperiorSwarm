import { create } from "zustand";

export type DiffContext =
	| {
			type: "pr";
			prId: number;
			workspaceSlug: string;
			repoSlug: string;
			repoPath: string;
			title: string;
			sourceBranch: string;
			targetBranch: string;
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
	diffMode: "split" | "inline";
	setActiveDiff: (ctx: DiffContext) => void;
	closeDiff: () => void;
	setDiffMode: (mode: "split" | "inline") => void;
}

export const useDiffStore = create<DiffStore>((set) => ({
	activeDiff: null,
	diffMode: "split",
	setActiveDiff: (ctx) => set({ activeDiff: ctx }),
	closeDiff: () => set({ activeDiff: null }),
	setDiffMode: (mode) => set({ diffMode: mode }),
}));
