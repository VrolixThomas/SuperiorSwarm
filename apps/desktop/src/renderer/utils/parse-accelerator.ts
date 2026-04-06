import type { Shortcut } from "../stores/action-store";

export function shortcutsMatch(a: Shortcut, b: Shortcut): boolean {
	return a.key === b.key && !!a.meta === !!b.meta && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

export function parseAccelerator(accelerator: string | null | undefined): Shortcut | null {
	if (!accelerator || !accelerator.trim()) return null;

	const parts = accelerator.split("+");
	const shortcut: Shortcut = { key: "" };

	for (const part of parts) {
		const lower = part.toLowerCase();
		if (
			lower === "commandorcontrol" ||
			lower === "cmd" ||
			lower === "ctrl" ||
			lower === "command" ||
			lower === "control"
		) {
			shortcut.meta = true;
		} else if (lower === "shift") {
			shortcut.shift = true;
		} else if (lower === "alt" || lower === "option") {
			shortcut.alt = true;
		} else {
			shortcut.key = part.length === 1 ? part.toLowerCase() : part;
		}
	}

	if (!shortcut.key) return null;
	return shortcut;
}
