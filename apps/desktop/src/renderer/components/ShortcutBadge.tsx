import type { Shortcut } from "../stores/action-store";

const KEY_SYMBOLS: Record<string, string> = {
	Enter: "↩",
	Backslash: "\\",
	BracketRight: "]",
	BracketLeft: "[",
	ArrowLeft: "←",
	ArrowRight: "→",
	ArrowUp: "↑",
	ArrowDown: "↓",
	Backspace: "⌫",
	Delete: "⌦",
	Escape: "esc",
	Shift: "⇧",
	Tab: "⇥",
	" ": "space",
};

function formatKey(key: string): string {
	if (KEY_SYMBOLS[key]) return KEY_SYMBOLS[key];
	if (key.length === 1) return key.toUpperCase();
	return key;
}

export function ShortcutBadge({ shortcut }: { shortcut: Shortcut }) {
	const parts: { id: string; label: string }[] = [];
	if (shortcut.meta) parts.push({ id: "meta", label: "⌘" });
	if (shortcut.shift) parts.push({ id: "shift", label: "⇧" });
	if (shortcut.alt) parts.push({ id: "alt", label: "⌥" });
	parts.push({ id: `key-${shortcut.key}`, label: formatKey(shortcut.key) });

	return (
		<span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--text-quaternary)]">
			{parts.map((part) => (
				<kbd
					key={part.id}
					className="inline-flex min-w-[18px] items-center justify-center rounded-[3px] bg-[var(--bg-base)] px-1 py-0.5 font-sans text-[10px] leading-none"
				>
					{part.label}
				</kbd>
			))}
		</span>
	);
}
