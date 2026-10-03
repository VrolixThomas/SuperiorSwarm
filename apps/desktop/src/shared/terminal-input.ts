// Binary input is a byte-valued xterm string, never Unicode text. A mouse
// report is tiny; one bounded frame avoids splitting a report under pressure.
export const BINARY_INPUT_CAPABILITY = "binary-input-v1";
export const MAX_BINARY_INPUT_BYTES = 16_384;
export const MAX_TERMINAL_INPUT_ID_LENGTH = 1_024;

export function isBinaryInput(id: unknown, data: unknown): data is string {
	if (
		typeof id !== "string" ||
		!id.length ||
		id.length > MAX_TERMINAL_INPUT_ID_LENGTH ||
		typeof data !== "string" ||
		!data.length ||
		data.length > MAX_BINARY_INPUT_BYTES
	)
		return false;
	for (let i = 0; i < data.length; i++) {
		if (data.charCodeAt(i) > 255) return false;
	}
	return true;
}
