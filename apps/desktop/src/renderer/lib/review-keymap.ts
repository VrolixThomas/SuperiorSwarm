import type { ReviewView } from "../stores/review-mode-store";

export type ReviewKeyAction =
	| "view-overview"
	| "view-changes"
	| "view-comments"
	| "escape"
	| "next"
	| "prev"
	| "toggle-viewed"
	| "new-comment"
	| "next-thread"
	| "prev-thread"
	| "accept"
	| "decline"
	| "edit"
	| "reply"
	| "open-in-changes"
	| "open-in-comments"
	| "toggle-navigator"
	| "toggle-rail-mode"
	| "ask-agent"
	| "open-threads"
	| "next-pr"
	| "prev-pr";

export function mapReviewKey(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
	view: ReviewView,
	options: { layout?: "path" } = {}
): ReviewKeyAction | null {
	if (event.key === "." && (event.metaKey || event.ctrlKey)) return "toggle-navigator";
	if (options.layout === "path" && (event.metaKey || event.ctrlKey) && !event.altKey) {
		if (event.key === "ArrowDown") return "next-pr";
		if (event.key === "ArrowUp") return "prev-pr";
	}
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
	if (options.layout === "path") {
		if (["1", "2", "3"].includes(event.key)) return null;
		if (event.key === "f") return "toggle-rail-mode";
		if (event.key === "/") return "ask-agent";
		if (event.key === "t") return "open-threads";
	}
	switch (event.key) {
		case "1":
			return "view-overview";
		case "2":
			return "view-changes";
		case "3":
			return "view-comments";
		case "Escape":
			return "escape";
		case "j":
			return "next";
		case "k":
			return "prev";
	}
	if (view === "changes") {
		switch (event.key) {
			case "v":
				return "toggle-viewed";
			case "c":
				return "new-comment";
			case "n":
				return "next-thread";
			case "p":
				return "prev-thread";
			case "o":
				return "open-in-comments";
		}
	}
	if (view === "comments") {
		switch (event.key) {
			case "a":
				return "accept";
			case "x":
				return "decline";
			case "e":
				return "edit";
			case "r":
				return "reply";
			case "o":
				return "open-in-changes";
		}
	}
	return null;
}

export function escapeTarget(state: {
	composerOpen?: boolean;
	panel?: "threads" | "ask" | null;
	queueOpen?: boolean;
	overviewOpen?: boolean;
}): "composer" | "panel" | "queue" | "overview" | "leave" {
	if (state.composerOpen) return "composer";
	if (state.panel) return "panel";
	if (state.queueOpen) return "queue";
	if (state.overviewOpen) return "overview";
	return "leave";
}
