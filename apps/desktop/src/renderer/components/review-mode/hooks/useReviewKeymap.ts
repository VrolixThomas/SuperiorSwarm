import { useCallback, useEffect, useMemo } from "react";
import type { PRContext, UnifiedThread } from "../../../../shared/github-types";
import { groupThreadsByFile, matchesReviewFilter } from "../../../lib/pr-review-threads";
import { type ReviewKeyAction, mapReviewKey } from "../../../lib/review-keymap";
import { openThreadInChanges } from "../../../lib/review-mode-nav";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { type ReviewView, useReviewModeStore } from "../../../stores/review-mode-store";
import { trpc } from "../../../trpc/client";
import type { ThreadCallbacks } from "../thread/ThreadCard";

interface UseReviewKeymapOptions {
	workspaceId: string;
	prCtx: PRContext;
	sessionKey: string;
	view: ReviewView;
	allThreads: UnifiedThread[];
	fileOrder: string[];
	callbacks: ThreadCallbacks;
}

interface ThreadRef {
	id: string;
	path: string;
}

const CHANGES_DRAFT_STATUSES = new Set(["pending", "edited", "user-pending"]);

function isReviewEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;

	if (target.classList.contains("inputarea") && target.closest(".monaco-diff-editor")) {
		return false;
	}

	if (target.isContentEditable || target.closest("[contenteditable]")) return true;

	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function sortThreadsByLine(a: UnifiedThread, b: UnifiedThread): number {
	const lineA = a.line ?? Number.MAX_SAFE_INTEGER;
	const lineB = b.line ?? Number.MAX_SAFE_INTEGER;
	if (lineA !== lineB) return lineA - lineB;
	return a.id.localeCompare(b.id);
}

function nextThreadRef(
	refs: ThreadRef[],
	activeThreadId: string | null,
	delta: 1 | -1
): ThreadRef | null {
	if (refs.length === 0) return null;

	const fallbackIndex = delta > 0 ? 0 : refs.length - 1;
	const currentIndex =
		activeThreadId === null ? -1 : refs.findIndex((thread) => thread.id === activeThreadId);
	if (currentIndex === -1) return refs[fallbackIndex] ?? null;

	const nextIndex = Math.min(refs.length - 1, Math.max(0, currentIndex + delta));
	return refs[nextIndex] ?? null;
}

function isActionableDraft(thread: UnifiedThread | null): thread is UnifiedThread & {
	isAIDraft: true;
	status: "pending" | "edited";
} {
	return Boolean(thread?.isAIDraft && (thread.status === "pending" || thread.status === "edited"));
}

export function useReviewKeymap({
	workspaceId,
	prCtx,
	sessionKey,
	view,
	allThreads,
	fileOrder,
	callbacks,
}: UseReviewKeymapOptions): void {
	const utils = trpc.useUtils();
	const activeFilePath = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const activeThreadId = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeThreadId ?? null
	);
	const advanceFile = usePRReviewSessionStore((s) => s.advanceFile);
	const selectThread = usePRReviewSessionStore((s) => s.selectThread);
	const setView = useReviewModeStore((s) => s.setView);
	const toggleNavigator = useReviewModeStore((s) => s.toggleNavigator);
	const drawerOpen = useReviewModeStore((s) => s.drawerOpen);
	const setDrawerOpen = useReviewModeStore((s) => s.setDrawerOpen);
	const close = useReviewModeStore((s) => s.close);
	const sendIntent = useReviewModeStore((s) => s.sendIntent);
	const commentFilter = useReviewModeStore((s) => s.commentFilter);
	const isGitHubPR = prCtx.provider === "github";
	const currentFilePath = activeFilePath ?? fileOrder[0] ?? null;

	const { data: viewedFilesList } = trpc.github.getViewedFiles.useQuery(
		{ owner: prCtx.owner, repo: prCtx.repo, number: prCtx.number },
		{ enabled: isGitHubPR, staleTime: 30_000 }
	);
	const { mutate: markFileViewed } = trpc.github.markFileViewed.useMutation({
		onSuccess: (_data, variables) =>
			utils.github.getViewedFiles.invalidate({
				owner: variables.owner,
				repo: variables.repo,
				number: variables.number,
			}),
	});

	const viewedFiles = useMemo(
		() => new Set(isGitHubPR ? (viewedFilesList ?? []) : []),
		[isGitHubPR, viewedFilesList]
	);

	const activeThread = useMemo(
		() =>
			activeThreadId === null
				? null
				: (allThreads.find((thread) => thread.id === activeThreadId) ?? null),
		[activeThreadId, allThreads]
	);

	const visibleCommentThreadRefs = useMemo(
		() =>
			groupThreadsByFile(
				allThreads.filter((thread) => matchesReviewFilter(thread, commentFilter)),
				fileOrder
			).flatMap((group) => group.threads.map((thread) => ({ id: thread.id, path: thread.path }))),
		[allThreads, commentFilter, fileOrder]
	);

	const activeFileThreadRefs = useMemo(() => {
		if (currentFilePath === null) return [];

		return allThreads
			.filter((thread) => {
				if (thread.path !== currentFilePath) return false;
				if (thread.diffSide === "LEFT") return false;
				if (!thread.isAIDraft) return true;
				return CHANGES_DRAFT_STATUSES.has(thread.status);
			})
			.sort(sortThreadsByLine)
			.map((thread) => ({ id: thread.id, path: thread.path }));
	}, [allThreads, currentFilePath]);

	const advanceThread = useCallback(
		(refs: ThreadRef[], delta: 1 | -1) => {
			const next = nextThreadRef(refs, activeThreadId, delta);
			if (next) selectThread(sessionKey, next.id);
		},
		[activeThreadId, selectThread, sessionKey]
	);

	const dispatchAction = useCallback(
		(action: ReviewKeyAction) => {
			switch (action) {
				case "view-overview":
					setView("overview");
					return;
				case "view-changes":
					setView("changes");
					return;
				case "view-comments":
					setView("comments");
					return;
				case "toggle-navigator":
					toggleNavigator();
					return;
				case "escape":
					if (drawerOpen) {
						setDrawerOpen(false);
					} else {
						close();
					}
					return;
				case "next":
					if (view === "changes") advanceFile(sessionKey, 1);
					if (view === "comments") advanceThread(visibleCommentThreadRefs, 1);
					return;
				case "prev":
					if (view === "changes") advanceFile(sessionKey, -1);
					if (view === "comments") advanceThread(visibleCommentThreadRefs, -1);
					return;
				case "toggle-viewed":
					if (!isGitHubPR || currentFilePath === null) return;
					markFileViewed({
						owner: prCtx.owner,
						repo: prCtx.repo,
						number: prCtx.number,
						filePath: currentFilePath,
						viewed: !viewedFiles.has(currentFilePath),
					});
					return;
				case "new-comment":
					sendIntent("new-comment");
					return;
				case "next-thread":
					advanceThread(activeFileThreadRefs, 1);
					return;
				case "prev-thread":
					advanceThread(activeFileThreadRefs, -1);
					return;
				case "accept":
					if (isActionableDraft(activeThread)) callbacks.onAccept?.(activeThread.draftCommentId);
					return;
				case "decline":
					if (isActionableDraft(activeThread)) callbacks.onDecline?.(activeThread.draftCommentId);
					return;
				case "edit":
					if (activeThreadId !== null) sendIntent("edit", activeThreadId);
					return;
				case "reply":
					if (activeThreadId !== null) sendIntent("reply", activeThreadId);
					return;
				case "open-in-changes":
					if (activeThread) {
						openThreadInChanges(workspaceId, prCtx, activeThread.path, activeThread.id);
					}
					return;
			}
		},
		[
			activeFileThreadRefs,
			activeThread,
			activeThreadId,
			advanceFile,
			advanceThread,
			callbacks,
			close,
			currentFilePath,
			drawerOpen,
			isGitHubPR,
			markFileViewed,
			prCtx,
			sendIntent,
			sessionKey,
			setDrawerOpen,
			setView,
			toggleNavigator,
			view,
			viewedFiles,
			visibleCommentThreadRefs,
			workspaceId,
		]
	);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented) return;
			if (isReviewEditableTarget(event.target)) return;

			const action = mapReviewKey(event, view);
			if (!action) return;

			event.preventDefault();
			dispatchAction(action);
		}

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [dispatchAction, view]);
}
