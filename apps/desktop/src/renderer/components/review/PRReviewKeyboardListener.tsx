import { useEffect } from "react";
import type { PRContext } from "../../../shared/github-types";
import { formatPrIdentifier } from "../../../shared/pr-identifier";
import { emitPRReviewEvent } from "../../lib/pr-review-events";
import { type PRReviewAction, mapKey } from "../../lib/pr-review-keymap";
import { prReviewSessionKey, usePRReviewSessionStore } from "../../stores/pr-review-session-store";
import { useTabStore } from "../../stores/tab-store";

const REVIEW_TAB_KINDS = new Set(["pr-review-file", "pr-overview"]);

function activeReviewTab(): { prCtx: PRContext; workspaceId: string } | null {
	const tabStore = useTabStore.getState();
	const activeId = tabStore.getActiveTabId();
	if (!activeId) return null;
	const tab = tabStore.getVisibleTabs().find((t) => t.id === activeId);
	if (!tab || !REVIEW_TAB_KINDS.has(tab.kind)) return null;
	if (tab.kind !== "pr-review-file" && tab.kind !== "pr-overview") return null;
	return { prCtx: tab.prCtx, workspaceId: tab.workspaceId };
}

/**
 * Skip shortcuts when typing in real form controls. Monaco's diff has a hidden
 * `<textarea class="inputarea">` that grabs focus on click; the diff is read-only,
 * so passing keys through to the listener is correct (the user is navigating,
 * not typing).
 */
function isReviewEditableTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	if (target.classList.contains("inputarea") && target.closest(".monaco-diff-editor")) {
		return false;
	}
	const tag = target.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function dispatch(action: PRReviewAction, workspaceId: string, prCtx: PRContext) {
	const key = prReviewSessionKey(workspaceId, formatPrIdentifier(prCtx));
	const store = usePRReviewSessionStore.getState();
	const session = store.sessions.get(key);

	switch (action) {
		case "file-next":
			store.advanceFile(key, 1);
			return;
		case "file-prev":
			store.advanceFile(key, -1);
			return;
		case "escape":
			if (session?.activeThreadId) store.selectThread(key, null);
			return;
		case "toggle-viewed":
			emitPRReviewEvent("toggle-viewed");
			return;
		case "new-comment":
			emitPRReviewEvent("new-comment");
			return;
	}
}

export function PRReviewKeyboardListener() {
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (isReviewEditableTarget(event.target)) return;
			const ctx = activeReviewTab();
			if (!ctx) return;
			const action = mapKey(event);
			if (!action) return;
			event.preventDefault();
			dispatch(action, ctx.workspaceId, ctx.prCtx);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return null;
}
