import { create } from "zustand";
import type { PRContext } from "../../shared/github-types";
import type { AskMessage } from "../../shared/review-path-types";
import type { SidebarSegment } from "../../shared/types";
import type { ReviewCommentFilter } from "../lib/pr-review-threads";

export type ReviewView = "overview" | "changes" | "comments" | "terminal";

export interface ReviewIntent {
	kind: "reply" | "edit" | "new-comment";
	threadId?: string;
	nonce: number;
}

export interface ReviewTerminal {
	/** Exact reading-path revision scope; absent for legacy terminals. */
	reviewScopeKey?: string;
	tabId: string;
	workspaceId: string;
	cwd: string;
}

export interface ReviewModeStore {
	railMode: "path" | "files" | null;
	panel: "threads" | "ask" | null;
	queueOpen: boolean;
	overviewOpen: boolean;
	askAnchor: AskMessage["anchor"] | null;
	setRailMode: (mode: "path" | "files" | null) => void;
	setPanel: (panel: "threads" | "ask" | null) => void;
	setQueueOpen: (open: boolean) => void;
	setOverviewOpen: (open: boolean) => void;
	setAskAnchor: (anchor: AskMessage["anchor"] | null) => void;
	active: { workspaceId: string; prCtx: PRContext } | null;
	lastWorkspaceId: string | null;
	view: ReviewView;
	navigatorCollapsed: boolean;
	drawerOpen: boolean;
	drawerHeight: number;
	terminals: Record<string, ReviewTerminal>;
	commentFilter: ReviewCommentFilter;
	publishedCommentsVisible: boolean;
	intent: ReviewIntent | null;

	open: (workspaceId: string, prCtx: PRContext) => void;
	close: () => void;
	setView: (view: ReviewView) => void;
	toggleNavigator: () => void;
	setDrawerOpen: (open: boolean) => void;
	setDrawerHeight: (height: number) => void;
	setTerminal: (terminal: ReviewTerminal) => void;
	setCommentFilter: (filter: ReviewCommentFilter) => void;
	setPublishedCommentsVisible: (visible: boolean) => void;
	togglePublishedComments: () => void;
	sendIntent: (kind: ReviewIntent["kind"], threadId?: string) => void;
	clearIntent: () => void;
}

export function shouldShowReviewMode(
	sidebarSegment: SidebarSegment,
	activeWorkspaceId: string | null,
	active: ReviewModeStore["active"],
	view?: ReviewView
): boolean {
	return (
		sidebarSegment === "prs" &&
		view !== "terminal" &&
		activeWorkspaceId !== null &&
		active?.workspaceId === activeWorkspaceId
	);
}

let nextIntentNonce = 0;

function createIntent(kind: ReviewIntent["kind"], threadId?: string): ReviewIntent {
	const nonce = ++nextIntentNonce;
	return threadId === undefined ? { kind, nonce } : { kind, threadId, nonce };
}

const readingPathDefaults = {
	railMode: null,
	panel: null,
	queueOpen: false,
	overviewOpen: false,
	askAnchor: null,
};

export const useReviewModeStore = create<ReviewModeStore>()((set) => ({
	...readingPathDefaults,
	active: null,
	lastWorkspaceId: null,
	view: "overview",
	navigatorCollapsed: false,
	drawerOpen: false,
	drawerHeight: 300,
	terminals: {},
	commentFilter: "all",
	publishedCommentsVisible: true,
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
				...readingPathDefaults,
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
			...readingPathDefaults,
			active: null,
			lastWorkspaceId: state.active?.workspaceId ?? state.lastWorkspaceId,
			drawerOpen: false,
			intent: null,
		})),

	setRailMode: (railMode) => set({ railMode }),
	setPanel: (panel) => set({ panel }),
	setQueueOpen: (queueOpen) => set({ queueOpen }),
	setOverviewOpen: (overviewOpen) => set({ overviewOpen }),
	setAskAnchor: (askAnchor) => set({ askAnchor }),
	setView: (view) => set({ view }),
	toggleNavigator: () => set((state) => ({ navigatorCollapsed: !state.navigatorCollapsed })),
	setDrawerOpen: (open) => set({ drawerOpen: open }),
	setDrawerHeight: (height) => set({ drawerHeight: Math.min(700, Math.max(180, height)) }),
	setTerminal: (terminal) =>
		set((state) => ({
			terminals: { ...state.terminals, [terminal.workspaceId]: terminal },
		})),
	setCommentFilter: (filter) => set({ commentFilter: filter }),
	setPublishedCommentsVisible: (visible) => set({ publishedCommentsVisible: visible }),
	togglePublishedComments: () =>
		set((state) => ({ publishedCommentsVisible: !state.publishedCommentsVisible })),
	sendIntent: (kind, threadId) => set({ intent: createIntent(kind, threadId) }),
	clearIntent: () => set({ intent: null }),
}));
