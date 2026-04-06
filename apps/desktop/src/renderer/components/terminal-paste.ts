import type { Terminal } from "@xterm/xterm";

/** Raw Ctrl+V byte — signals the PTY process to read the system clipboard. */
const CTRL_V = "\x16";

/**
 * Check whether the clipboard contains binary payload (images, files).
 * Text-based types like text/html are intentionally excluded.
 */
export function hasImageOrFilePayload(clipboardData: DataTransfer): boolean {
	const types = Array.from(clipboardData.types);
	return types.some((type) => type === "Files" || type.startsWith("image/"));
}

/**
 * Intercept paste events on the terminal's hidden textarea.
 *
 * - Text clipboard: delegates to `term.paste()` (respects bracketed paste mode).
 * - Image/file clipboard (no text): forwards raw Ctrl+V (`\x16`) to the PTY so
 *   the running CLI agent can read the system clipboard directly.
 * - Empty clipboard: ignored.
 *
 * Returns a cleanup function that removes the listener.
 */
export function interceptPaste(term: Terminal, writeToPty: (data: string) => void): () => void {
	const textarea = term.textarea;
	if (!textarea) return () => {};

	const handlePaste = (event: ClipboardEvent) => {
		const clipboardData = event.clipboardData;
		if (!clipboardData) return;

		const text = clipboardData.getData("text/plain");

		if (text) {
			event.preventDefault();
			event.stopImmediatePropagation();
			term.paste(text);
			return;
		}

		if (hasImageOrFilePayload(clipboardData)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			writeToPty(CTRL_V);
			return;
		}
	};

	textarea.addEventListener("paste", handlePaste, { capture: true });

	return () => {
		textarea.removeEventListener("paste", handlePaste, { capture: true });
	};
}
