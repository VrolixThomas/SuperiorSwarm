import { useEffect } from "react";
import { type Shortcut, useActionStore } from "../stores/action-store";
import { shortcutsMatch } from "../utils/parse-accelerator";

function isTextInputElement(target: HTMLElement): boolean {
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function isTerminalElement(target: HTMLElement): boolean {
	if (target.closest(".xterm")) return true;
	return target.classList.contains("xterm-helper-textarea");
}

function isPlainPrintableKey(e: KeyboardEvent): boolean {
	return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export function shouldSkipShortcutHandling(e: KeyboardEvent, target: HTMLElement | null): boolean {
	if (!target) return false;

	if (isTerminalElement(target)) {
		if (isPlainPrintableKey(e)) return true;
		if (e.metaKey || e.ctrlKey || e.altKey) return false;
	}

	if (isTextInputElement(target) && !e.metaKey && !e.ctrlKey) {
		return true;
	}

	return false;
}

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
			if (shouldSkipShortcutHandling(e, target)) {
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
