export type PRReviewAction =
	| "file-next"
	| "file-prev"
	| "thread-next"
	| "thread-prev"
	| "toggle-viewed"
	| "new-comment"
	| "reply"
	| "resolve"
	| "ai-accept"
	| "ai-decline"
	| "ai-edit"
	| "escape"
	| "open-overview"
	| "submit-review"
	| "toggle-shortcuts";

export function mapKey(event: KeyboardEvent): PRReviewAction | null {
	const isCmdEnter = event.key === "Enter" && event.metaKey && !event.ctrlKey && !event.altKey;
	if (isCmdEnter) return "submit-review";

	if (event.metaKey || event.ctrlKey || event.altKey) return null;

	switch (event.key) {
		case "j":
			return "file-next";
		case "k":
			return "file-prev";
		case "n":
			return "thread-next";
		case "N":
			return "thread-prev";
		case "v":
			return "toggle-viewed";
		case "c":
			return "new-comment";
		case "r":
			return "reply";
		case "R":
			return "resolve";
		case "a":
			return "ai-accept";
		case "d":
			return "ai-decline";
		case "e":
			return "ai-edit";
		case "Escape":
			return "escape";
		case "S":
			return "open-overview";
		case "?":
			return "toggle-shortcuts";
		default:
			return null;
	}
}
