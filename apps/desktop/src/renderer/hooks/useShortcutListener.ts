import { useEffect } from "react";
import { type Shortcut, useActionStore } from "../stores/action-store";
import { shortcutsMatch } from "../utils/parse-accelerator";

export function matchesShortcut(e: KeyboardEvent, shortcut: Shortcut): boolean {
	const eventShortcut: Shortcut = {
		key: e.key,
		meta: e.metaKey || e.ctrlKey,
		shift: e.shiftKey,
		alt: e.altKey,
	};
	if (shortcutsMatch(eventShortcut, shortcut)) return true;
	// Fall back to e.code for physical key matching (e.g. "Backslash")
	if (e.code !== e.key) {
		eventShortcut.key = e.code;
		return shortcutsMatch(eventShortcut, shortcut);
	}
	return false;
}

export function useShortcutListener() {
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT") &&
				!e.metaKey &&
				!e.ctrlKey
			) {
				return;
			}

			const actions = useActionStore.getState().actions;
			for (const action of actions.values()) {
				if (!action.shortcut) continue;
				if (!matchesShortcut(e, action.shortcut)) continue;
				if (action.when && !action.when()) continue;

				e.preventDefault();
				e.stopPropagation();
				action.execute();
				return;
			}
		}

		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, []);
}
