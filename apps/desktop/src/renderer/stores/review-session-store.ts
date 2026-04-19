import { create } from "zustand";
import type { ReviewScope, ScopedDiffFile } from "../../shared/review-types";

export interface ReviewSession {
	workspaceId: string;
	scope: ReviewScope;
	selectedFilePath: string | null;
	editSplitPaneId: string | null;
	editOverlay: Map<string, string>;
}

export interface ReviewSessionStore {
	activeSession: ReviewSession | null;

	startSession: (args: {
		workspaceId: string;
		scope?: ReviewScope;
		filePath?: string;
	}) => void;
	endSession: () => void;

	selectFile: (path: string | null) => void;
	nextFile: (scopedFiles: ScopedDiffFile[]) => void;
	prevFile: (scopedFiles: ScopedDiffFile[]) => void;

	setScope: (scope: ReviewScope, scopedFiles?: ScopedDiffFile[]) => void;

	setEditSplitPaneId: (paneId: string | null) => void;
	pushOptimisticContent: (path: string, content: string) => void;
	clearOptimisticContent: (path: string) => void;
	getOptimisticContent: (path: string) => string | undefined;
}

export const useReviewSessionStore = create<ReviewSessionStore>()((set, get) => ({
	activeSession: null,

	startSession: ({ workspaceId, scope, filePath }) => {
		const current = get().activeSession;
		const preserveOverlay = current !== null && current.workspaceId === workspaceId;
		set({
			activeSession: {
				workspaceId,
				scope: scope ?? current?.scope ?? "all",
				selectedFilePath: filePath ?? current?.selectedFilePath ?? null,
				editSplitPaneId: preserveOverlay ? current.editSplitPaneId : null,
				editOverlay: preserveOverlay ? current.editOverlay : new Map(),
			},
		});
	},

	endSession: () => set({ activeSession: null }),

	selectFile: (path) => {
		const s = get().activeSession;
		if (!s) return;
		set({ activeSession: { ...s, selectedFilePath: path } });
	},

	nextFile: (scopedFiles) => {
		const s = get().activeSession;
		if (!s || scopedFiles.length === 0) return;
		const idx = scopedFiles.findIndex((f) => f.path === s.selectedFilePath);
		const nextIdx = Math.min(idx + 1, scopedFiles.length - 1);
		const next = scopedFiles[nextIdx];
		if (!next || next.path === s.selectedFilePath) return;
		set({ activeSession: { ...s, selectedFilePath: next.path } });
	},

	prevFile: (scopedFiles) => {
		const s = get().activeSession;
		if (!s || scopedFiles.length === 0) return;
		const idx = scopedFiles.findIndex((f) => f.path === s.selectedFilePath);
		const prevIdx = Math.max(idx === -1 ? 0 : idx - 1, 0);
		const prev = scopedFiles[prevIdx];
		if (!prev || prev.path === s.selectedFilePath) return;
		set({ activeSession: { ...s, selectedFilePath: prev.path } });
	},

	setScope: (scope, scopedFiles) => {
		const s = get().activeSession;
		if (!s) return;
		const next = { ...s, scope };
		if (scopedFiles) {
			const stillInScope = scopedFiles.some((f) => f.path === s.selectedFilePath);
			if (!stillInScope) {
				next.selectedFilePath = scopedFiles[0]?.path ?? null;
			}
		}
		set({ activeSession: next });
	},

	setEditSplitPaneId: (paneId) => {
		const s = get().activeSession;
		if (!s) return;
		set({ activeSession: { ...s, editSplitPaneId: paneId } });
	},

	pushOptimisticContent: (path, content) => {
		const s = get().activeSession;
		if (!s) return;
		const next = new Map(s.editOverlay);
		next.set(path, content);
		set({ activeSession: { ...s, editOverlay: next } });
	},

	clearOptimisticContent: (path) => {
		const s = get().activeSession;
		if (!s) return;
		if (!s.editOverlay.has(path)) return;
		const next = new Map(s.editOverlay);
		next.delete(path);
		set({ activeSession: { ...s, editOverlay: next } });
	},

	getOptimisticContent: (path) => {
		return get().activeSession?.editOverlay.get(path);
	},
}));
