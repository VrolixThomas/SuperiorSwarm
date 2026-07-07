const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Build the byte sequence that inserts `text` into a terminal application as a
 * single bracketed paste and then submits it with a carriage return. Newlines
 * inside `text` stay literal — only the trailing CR triggers submission.
 */
export function bracketedPasteSubmit(text: string): string {
	return `${PASTE_START}${text}${PASTE_END}\r`;
}
