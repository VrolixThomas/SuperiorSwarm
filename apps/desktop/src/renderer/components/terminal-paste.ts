import type { Terminal } from "@xterm/xterm";

/**
 * Check whether the clipboard contains any non-text payload (images, files, etc.).
 */
export function hasNonTextPayload(clipboardData: DataTransfer): boolean {
	const types = Array.from(clipboardData.types);
	if (types.length === 0) return false;
	return types.some((type) => type !== "text/plain");
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
export function interceptPaste(
	term: Terminal,
	writeToPty: (data: string) => void,
): () => void {
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

		if (hasNonTextPayload(clipboardData)) {
			event.preventDefault();
			event.stopImmediatePropagation();
			writeToPty("\x16");
			return;
		}
	};

	textarea.addEventListener("paste", handlePaste, { capture: true });

	return () => {
		textarea.removeEventListener("paste", handlePaste, { capture: true });
	};
}
