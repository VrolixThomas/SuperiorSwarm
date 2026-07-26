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
	| "toggle-navigator";

export function mapReviewKey(
	event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
	view: ReviewView
): ReviewKeyAction | null {
	if (event.key === "." && (event.metaKey || event.ctrlKey)) return "toggle-navigator";
	if (event.metaKey || event.ctrlKey || event.altKey) return null;
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
