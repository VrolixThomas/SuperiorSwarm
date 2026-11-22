import { create } from "zustand";
import type { PRContext } from "../../shared/github-types";
import type { QueuePROrigin } from "../../shared/queue-pr-publication";
import type { SidebarSegment } from "../../shared/types";
import type { ReviewCommentFilter } from "../lib/pr-review-threads";

export type ReviewView = "overview" | "changes" | "comments" | "terminal";

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

export type QueueReviewOrigin = QueuePROrigin & { workspaceId: string };

export function reviewSessionIdentity(workspaceId: string, prCtx: PRContext): string {
	return JSON.stringify([workspaceId, prCtx.provider, prCtx.owner, prCtx.repo, prCtx.number]);
}

export interface ReviewModeStore {
	draftText: Record<string, string>;
	draftVersions: Record<string, number>;
	setDraftText: (key: string, value: string) => void;
	queueOrigin: QueueReviewOrigin | null;
	queueOrigins: Record<string, QueueReviewOrigin>;
	setQueueOrigin: (origin: QueueReviewOrigin | null) => void;
	dropQueueOriginsForWorkspace: (workspaceId: string) => void;
	restoreQueueState: (origins?: string, drafts?: string) => void;
	clearDraftText: (key: string, submittedText: string, version?: number) => boolean;
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
	active: ReviewModeStore["active"]
): boolean {
	return (
		sidebarSegment === "prs" &&
		activeWorkspaceId !== null &&
		active?.workspaceId === activeWorkspaceId
	);
}

let nextIntentNonce = 0;

function createIntent(kind: ReviewIntent["kind"], threadId?: string): ReviewIntent {
	const nonce = ++nextIntentNonce;
	return threadId === undefined ? { kind, nonce } : { kind, threadId, nonce };
}

export const useReviewModeStore = create<ReviewModeStore>()((set, get) => ({
	draftText: {},
	draftVersions: {},
	setDraftText: (key, value) =>
		set((state) => ({
			draftText: { ...state.draftText, [key]: value },
			draftVersions: { ...state.draftVersions, [key]: (state.draftVersions[key] ?? 0) + 1 },
		})),
	clearDraftText: (key, submittedText, version) => {
		if ((get().draftText[key] ?? "") !== submittedText || get().draftVersions[key] !== version)
			return false;
		set((state) => ({ draftText: { ...state.draftText, [key]: "" } }));
		return true;
	},
	active: null,
	queueOrigin: null,
	queueOrigins: {},
	setQueueOrigin: (queueOrigin) =>
		set((state) => {
			const active = state.active;
			if (!active || (queueOrigin && queueOrigin.workspaceId !== active.workspaceId)) return state;
			const key = reviewSessionIdentity(active.workspaceId, active.prCtx);
			const queueOrigins = { ...state.queueOrigins };
			if (queueOrigin) queueOrigins[key] = queueOrigin;
			else delete queueOrigins[key];
			return { queueOrigin, queueOrigins };
		}),
	dropQueueOriginsForWorkspace: (workspaceId) =>
		set((state) => ({
			queueOrigins: Object.fromEntries(
				Object.entries(state.queueOrigins).filter(([, value]) => value.workspaceId !== workspaceId)
			),
			queueOrigin: state.queueOrigin?.workspaceId === workspaceId ? null : state.queueOrigin,
		})),
	restoreQueueState: (origins, drafts) => {
		const queueOrigins: Record<string, QueueReviewOrigin> = {};
		const draftText: Record<string, string> = {};
		try {
			const parsed: unknown = JSON.parse(origins ?? "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				for (const [key, value] of Object.entries(parsed)) {
					if (!value || typeof value !== "object") continue;
					const candidate = value as Record<string, unknown>;
					if (
						typeof candidate["id"] === "string" &&
						typeof candidate["workspaceId"] === "string" &&
						typeof candidate["revision"] === "number" &&
						Number.isSafeInteger(candidate["revision"]) &&
						candidate["revision"] > 0
					)
						queueOrigins[key] = {
							id: candidate["id"],
							workspaceId: candidate["workspaceId"],
							revision: candidate["revision"],
						};
				}
			}
		} catch {
			/* Ignore invalid optional snapshot data. Main still validates every publication. */
		}
		try {
			const parsed: unknown = JSON.parse(drafts ?? "{}");
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				for (const [key, value] of Object.entries(parsed))
					if (typeof value === "string") draftText[key] = value;
			}
		} catch {
			/* Keep invalid draft data out of controlled inputs. */
		}
		set({ queueOrigins, draftText, draftVersions: {}, queueOrigin: null });
	},
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
					queueOrigin: state.queueOrigins[reviewSessionIdentity(workspaceId, prCtx)] ?? null,
					lastWorkspaceId: null,
					intent: null,
				};
			}
			return {
				active: { workspaceId, prCtx },
				queueOrigin: state.queueOrigins[reviewSessionIdentity(workspaceId, prCtx)] ?? null,
				lastWorkspaceId: null,
				view: "overview",
				drawerOpen: false,
				commentFilter: "all",
				intent: null,
			};
		}),

	close: () =>
		set((state) => {
			const queueOrigins = { ...state.queueOrigins };
			if (state.active)
				delete queueOrigins[reviewSessionIdentity(state.active.workspaceId, state.active.prCtx)];
			return {
				active: null,
				queueOrigin: null,
				queueOrigins,
				lastWorkspaceId: state.active?.workspaceId ?? state.lastWorkspaceId,
				drawerOpen: false,
				intent: null,
			};
		}),

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
