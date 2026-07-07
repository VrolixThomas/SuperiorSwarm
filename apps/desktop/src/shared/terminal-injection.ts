const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Strips raw ESC (0x1B), BEL (0x07), and C1 control (0x80-0x9F) bytes from
 * `text`. Without this, a comment/file snapshot containing a literal
 * "\x1b[201~" (the paste-end marker) — or its one-byte C1-CSI form
 * "\x9b201~" — would terminate the bracketed paste early and turn the
 * remainder of `text` into live keystrokes in the terminal: arbitrary input
 * injection. Control sequences without their ESC/C1 introducer are inert
 * printable characters, so stripping these bytes is sufficient.
 */
function sanitizeForPaste(text: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching raw ESC/BEL/C1 bytes to strip them
	return text.replace(/[\x07\x1b\x80-\x9f]/g, "");
}

/**
 * Build the byte sequence that inserts `text` into a terminal application as a
 * single bracketed paste and then submits it with a carriage return. Newlines
 * inside `text` stay literal — only the trailing CR triggers submission.
 *
 * `text` is sanitized first: raw ESC (0x1B), BEL (0x07), and C1 control
 * (0x80-0x9F) bytes are removed so embedded escape/control sequences (e.g. a
 * literal paste-end marker, in either its ESC-prefixed or single-byte C1-CSI
 * form) cannot terminate the paste block early or otherwise inject terminal
 * control input. The only paste-end marker in the output is the wrapper's own,
 * at the end.
 */
export function bracketedPasteSubmit(text: string): string {
	return `${PASTE_START}${sanitizeForPaste(text)}${PASTE_END}\r`;
}
