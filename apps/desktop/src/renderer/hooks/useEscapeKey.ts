import { useEffect } from "react";

export function useEscapeKey(onEscape: () => void, enabled = true): void {
	useEffect(() => {
		if (!enabled) return;
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onEscape();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onEscape, enabled]);
}
