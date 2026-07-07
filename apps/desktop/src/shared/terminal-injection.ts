const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Strips raw ESC (0x1B) and BEL (0x07) bytes from `text`. Without this, a
 * comment/file snapshot containing a literal "\x1b[201~" (the paste-end
 * marker) would terminate the bracketed paste early and turn the remainder
 * of `text` into live keystrokes in the terminal — arbitrary input
 * injection. CSI sequences without their ESC prefix are inert printable
 * characters, so stripping the ESC/BEL bytes alone is sufficient.
 */
function sanitizeForPaste(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching raw ESC/BEL bytes to strip them
	return text.replace(/[\x07\x1b]/g, "");
}

/**
 * Build the byte sequence that inserts `text` into a terminal application as a
 * single bracketed paste and then submits it with a carriage return. Newlines
 * inside `text` stay literal — only the trailing CR triggers submission.
 *
 * `text` is sanitized first: raw ESC (0x1B) and BEL (0x07) bytes are removed
 * so embedded escape/control sequences (e.g. a literal paste-end marker)
 * cannot terminate the paste block early or otherwise inject terminal
 * control input. The only paste-end marker in the output is the wrapper's own,
 * at the end.
 */
export function bracketedPasteSubmit(text: string): string {
	return `${PASTE_START}${sanitizeForPaste(text)}${PASTE_END}\r`;
}
