import { useEffect } from "react";
import { emitSolveReviewEvent } from "../../lib/solve-review-events";

/**
 * Window-level keyboard handler for the Solve Review tab. Active only when the
 * tab is mounted. Skips when focus is in an editable element so textarea/input
 * keystrokes pass through.
 */
export function useSolveKeyboard(enabled: boolean) {
	useEffect(() => {
		if (!enabled) return;
		function isEditable(el: EventTarget | null): boolean {
			if (!(el instanceof HTMLElement)) return false;
			const tag = el.tagName;
			return (
				tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true
			);
		}
		function onKey(e: KeyboardEvent) {
			if (isEditable(e.target)) return;
			if (e.metaKey && e.key === "\\") {
				e.preventDefault();
				emitSolveReviewEvent("toggle-sidebar");
				return;
			}
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			switch (e.key) {
				case "j":
					e.preventDefault();
					emitSolveReviewEvent("select-file", { delta: 1 });
					break;
				case "k":
					e.preventDefault();
					emitSolveReviewEvent("select-file", { delta: -1 });
					break;
				case "J":
					e.preventDefault();
					emitSolveReviewEvent("select-group", { delta: 1 });
					break;
				case "K":
					e.preventDefault();
					emitSolveReviewEvent("select-group", { delta: -1 });
					break;
				case "n":
					emitSolveReviewEvent("next-comment", { delta: 1 });
					break;
				case "N":
					emitSolveReviewEvent("next-comment", { delta: -1 });
					break;
				case "a":
					e.preventDefault();
					emitSolveReviewEvent("approve-current-group");
					break;
				case "r":
					e.preventDefault();
					emitSolveReviewEvent("revoke-current-group");
					break;
				case "p":
					e.preventDefault();
					emitSolveReviewEvent("push-current-group");
					break;
				case "Enter":
					emitSolveReviewEvent("open-follow-up");
					break;
				case "Escape":
					emitSolveReviewEvent("clear-active");
					break;
				case "[":
				case "]":
					e.preventDefault();
					emitSolveReviewEvent("toggle-group");
					break;
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [enabled]);
}
