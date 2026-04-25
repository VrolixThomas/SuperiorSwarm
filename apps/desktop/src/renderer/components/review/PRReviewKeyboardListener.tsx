import { useEffect } from "react";
import type { PRContext } from "../../../shared/github-types";
import { mapKey, type PRReviewAction } from "../../lib/pr-review-keymap";
import {
	prReviewSessionKey,
	usePRReviewSessionStore,
} from "../../stores/pr-review-session-store";
import { useTabStore } from "../../stores/tab-store";

function isEditableTarget(el: EventTarget | null): boolean {
	if (!(el instanceof HTMLElement)) return false;
	const tag = el.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	if (el.isContentEditable) return true;
	if (el.closest('[contenteditable="true"]')) return true;
	if (el.closest(".monaco-editor textarea")) return true;
	if (el.classList.contains("inputarea")) return true;
	return false;
}

function dispatch(action: PRReviewAction, prCtx: PRContext, workspaceId: string) {
	const key = prReviewSessionKey(workspaceId, `${prCtx.owner}/${prCtx.repo}#${prCtx.number}`);
	const store = usePRReviewSessionStore.getState();
	const session = store.sessions.get(key);

	switch (action) {
		case "file-next":
			store.advanceFile(key, 1);
			return;
		case "file-prev":
			store.advanceFile(key, -1);
			return;
		case "thread-next":
			store.advanceThread(key, 1);
			return;
		case "thread-prev":
			store.advanceThread(key, -1);
			return;
		case "open-overview":
			useTabStore.getState().openPROverview(workspaceId, prCtx);
			return;
		case "escape":
			if (session?.activeThreadId) store.selectThread(key, null);
			window.dispatchEvent(new CustomEvent("pr-review:escape"));
			return;
		case "toggle-viewed":
			window.dispatchEvent(new CustomEvent("pr-review:toggle-viewed"));
			return;
		case "new-comment":
			window.dispatchEvent(new CustomEvent("pr-review:new-comment"));
			return;
		case "reply":
			window.dispatchEvent(new CustomEvent("pr-review:reply"));
			return;
		case "resolve":
			window.dispatchEvent(new CustomEvent("pr-review:resolve"));
			return;
		case "ai-accept":
			window.dispatchEvent(new CustomEvent("pr-review:ai-accept"));
			return;
		case "ai-decline":
			window.dispatchEvent(new CustomEvent("pr-review:ai-decline"));
			return;
		case "ai-edit":
			window.dispatchEvent(new CustomEvent("pr-review:ai-edit"));
			return;
		case "submit-review":
			window.dispatchEvent(new CustomEvent("pr-review:submit"));
			return;
		case "toggle-shortcuts":
			window.dispatchEvent(new CustomEvent("pr-review:toggle-shortcuts"));
			return;
	}
}

export function PRReviewKeyboardListener({
	prCtx,
	workspaceId,
}: {
	prCtx: PRContext;
	workspaceId: string;
}) {
	useEffect(() => {
		function onKey(event: KeyboardEvent) {
			if (isEditableTarget(event.target)) return;
			const action = mapKey(event);
			if (!action) return;
			event.preventDefault();
			dispatch(action, prCtx, workspaceId);
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [prCtx, workspaceId]);

	return null;
}
