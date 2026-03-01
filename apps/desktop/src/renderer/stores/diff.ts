import { create } from "zustand";
export type { DiffContext } from "../../shared/diff-types";
import type { DiffContext } from "../../shared/diff-types";

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
