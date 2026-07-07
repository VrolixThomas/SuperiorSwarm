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
	lastWorkspaceId: string | null;
	view: ReviewView;
	navigatorCollapsed: boolean;
	drawerOpen: boolean;
	terminals: Record<string, ReviewTerminal>;
	commentFilter: ReviewCommentFilter;
	intent: ReviewIntent | null;

	open: (workspaceId: string, prCtx: PRContext) => void;
	close: () => void;
	setView: (view: ReviewView) => void;
	toggleNavigator: () => void;
	setDrawerOpen: (open: boolean) => void;
	setTerminal: (terminal: ReviewTerminal) => void;
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
	lastWorkspaceId: null,
	view: "overview",
	navigatorCollapsed: false,
	drawerOpen: false,
	terminals: {},
	commentFilter: "all",
	intent: null,

	open: (workspaceId, prCtx) =>
		set((state) => {
			const sameWorkspace =
				state.active?.workspaceId === workspaceId || state.lastWorkspaceId === workspaceId;
			if (sameWorkspace) {
				return {
					active: { workspaceId, prCtx },
					lastWorkspaceId: null,
					intent: null,
				};
			}
			return {
				active: { workspaceId, prCtx },
				lastWorkspaceId: null,
				view: "overview",
				drawerOpen: false,
				commentFilter: "all",
				intent: null,
			};
		}),

	close: () =>
		set((state) => ({
			active: null,
			lastWorkspaceId: state.active?.workspaceId ?? state.lastWorkspaceId,
			drawerOpen: false,
			intent: null,
		})),

	setView: (view) => set({ view }),
	toggleNavigator: () => set((state) => ({ navigatorCollapsed: !state.navigatorCollapsed })),
	setDrawerOpen: (open) => set({ drawerOpen: open }),
	setTerminal: (terminal) =>
		set((state) => ({
			terminals: { ...state.terminals, [terminal.workspaceId]: terminal },
		})),
	setCommentFilter: (filter) => set({ commentFilter: filter }),
	sendIntent: (kind, threadId) => set({ intent: createIntent(kind, threadId) }),
	clearIntent: () => set({ intent: null }),
}));
