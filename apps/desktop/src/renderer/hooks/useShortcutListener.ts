import { useEffect } from "react";
import { type Shortcut, useActionStore } from "../stores/action-store";

export function matchesShortcut(e: KeyboardEvent, shortcut: Shortcut): boolean {
	const meta = e.metaKey || e.ctrlKey;
	if (!!shortcut.meta !== meta) return false;
	if (!!shortcut.shift !== e.shiftKey) return false;
	if (!!shortcut.alt !== e.altKey) return false;
	return e.key === shortcut.key || e.code === shortcut.key;
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
