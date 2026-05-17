import { create } from "zustand";

interface OrchestratorHintsStore {
	coachmarkAnchor: { x: number; y: number } | null;
	coachmarkFired: boolean;
	showCoachmark: (anchor: { x: number; y: number }) => void;
	clearCoachmark: () => void;
}

export const useOrchestratorHintsStore = create<OrchestratorHintsStore>((set, get) => ({
	coachmarkAnchor: null,
	coachmarkFired: false,
	showCoachmark: (anchor) => {
		if (get().coachmarkFired) return;
		set({ coachmarkAnchor: anchor, coachmarkFired: true });
	},
	clearCoachmark: () => set({ coachmarkAnchor: null }),
}));
