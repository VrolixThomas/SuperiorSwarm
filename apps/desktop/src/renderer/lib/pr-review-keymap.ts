export type PRReviewAction = "file-next" | "file-prev" | "toggle-viewed" | "new-comment" | "escape";

export function mapKey(event: KeyboardEvent): PRReviewAction | null {
	if (event.metaKey || event.ctrlKey || event.altKey) return null;

	switch (event.key) {
		case "j":
			return "file-next";
		case "k":
			return "file-prev";
		case "v":
			return "toggle-viewed";
		case "c":
			return "new-comment";
		case "Escape":
			return "escape";
		default:
			return null;
	}
}
