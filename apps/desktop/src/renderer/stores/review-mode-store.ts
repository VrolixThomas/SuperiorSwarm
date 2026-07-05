import { create } from "zustand";
import type { PRContext } from "../../shared/github-types";
import type { ReviewCommentFilter } from "../lib/pr-review-threads";

export type ReviewView = "overview" | "changes" | "comments";

export interface ReviewIntent {
	kind: "reply" | "edit" | "new-comment";
	threadId?: string;
	nonce: number;
}

export interface ReviewTerminal {
	tabId: string;
	workspaceId: string;
	cwd: string;
}

export interface ReviewModeStore {
	active: { workspaceId: string; prCtx: PRContext } | null;
	view: ReviewView;
	navigatorCollapsed: boolean;
	drawerOpen: boolean;
	terminal: ReviewTerminal | null;
	commentFilter: ReviewCommentFilter;
	intent: ReviewIntent | null;

	open: (workspaceId: string, prCtx: PRContext) => void;
	close: () => void;
	setView: (view: ReviewView) => void;
	toggleNavigator: () => void;
	setDrawerOpen: (open: boolean) => void;
	setTerminal: (terminal: ReviewTerminal | null) => void;
	setCommentFilter: (filter: ReviewCommentFilter) => void;
	sendIntent: (kind: ReviewIntent["kind"], threadId?: string) => void;
	clearIntent: () => void;
}

let nextIntentNonce = 0;

function createIntent(kind: ReviewIntent["kind"], threadId?: string): ReviewIntent {
	const nonce = ++nextIntentNonce;
	return threadId === undefined ? { kind, nonce } : { kind, threadId, nonce };
}

export const useReviewModeStore = create<ReviewModeStore>()((set) => ({
	active: null,
	view: "overview",
	navigatorCollapsed: false,
	drawerOpen: false,
	terminal: null,
	commentFilter: "all",
	intent: null,

	open: (workspaceId, prCtx) =>
		set({
			active: { workspaceId, prCtx },
			view: "overview",
			drawerOpen: false,
			terminal: null,
			commentFilter: "all",
			intent: null,
		}),

	close: () =>
		set({
			active: null,
			drawerOpen: false,
			intent: null,
		}),

	setView: (view) => set({ view }),
	toggleNavigator: () => set((state) => ({ navigatorCollapsed: !state.navigatorCollapsed })),
	setDrawerOpen: (open) => set({ drawerOpen: open }),
	setTerminal: (terminal) => set({ terminal }),
	setCommentFilter: (filter) => set({ commentFilter: filter }),
	sendIntent: (kind, threadId) => set({ intent: createIntent(kind, threadId) }),
	clearIntent: () => set({ intent: null }),
}));
