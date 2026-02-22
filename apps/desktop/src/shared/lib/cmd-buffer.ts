const MAX_CSI_PARAMS = 32;
const MAX_BUF = 512;

/**
 * Tracks user keystrokes to derive a command name for tab titles.
 * Consumes escape sequences so they never pollute the buffer.
 *
 * Pure logic — no DOM, no store, no side effects.
 */
export class CmdBuffer {
	/** 0=normal, 1=after ESC, 2=CSI, 3=SS3/SS2, 4=string-terminated body, 5=ESC inside string */
	private esc: 0 | 1 | 2 | 3 | 4 | 5 = 0;
	private csiParams = "";
	private inPaste = false;
	private buf = "";

	/** Current buffer contents. */
	get current(): string {
		return this.buf;
	}

	/** Reset all state. */
	reset(): void {
		this.esc = 0;
		this.csiParams = "";
		this.inPaste = false;
		this.buf = "";
	}

	/**
	 * Feed raw input data through the parser.
	 * Returns the trimmed command string when Enter (\r) is pressed, otherwise null.
	 */
	feed(data: string): string | null {
		let result: string | null = null;

		for (const ch of data) {
			const code = ch.charCodeAt(0);

			// ── Escape sequence state machine ──

			// State 5: inside string-terminated body, saw ESC — check for backslash (ST)
			if (this.esc === 5) {
				this.esc = code === 0x5c /* \ */ ? 0 : 4;
				continue;
			}

			// State 4: inside string-terminated body (OSC/DCS/APC/PM/SOS) — consume until ST or BEL
			if (this.esc === 4) {
				if (code === 0x1b) this.esc = 5;
				else if (code === 0x07) this.esc = 0;
				continue;
			}

			// State 3: SS3/SS2 — consume param bytes, then one final byte (0x40-0x7E)
			if (this.esc === 3) {
				if (code >= 0x30 && code <= 0x3f) continue;
				this.esc = 0;
				continue;
			}

			// State 2: CSI — param bytes (0x30-0x3F), intermediates (0x20-0x2F), final (0x40-0x7E)
			if (this.esc === 2) {
				if (code >= 0x30 && code <= 0x3f) {
					// Stop accumulating past the cap but stay in state 2
					// so the rest of the sequence is still consumed.
					if (this.csiParams.length < MAX_CSI_PARAMS) {
						this.csiParams += ch;
					}
					continue;
				}
				if (code >= 0x20 && code <= 0x2f) continue; // intermediate bytes
				if (code >= 0x40 && code <= 0x7e) {
					if (ch === "~") {
						if (this.csiParams === "200") this.inPaste = true;
						else if (this.csiParams === "201") {
							this.inPaste = false;
							this.buf = "";
						}
					}
					this.csiParams = "";
					this.esc = 0;
				}
				continue;
			}

			// State 1: after ESC — determine which family
			if (this.esc === 1) {
				this.esc = 0;
				if (ch === "[") {
					this.esc = 2;
					this.csiParams = "";
				} else if (ch === "O" || ch === "N") {
					this.esc = 3; // SS3 / SS2
				} else if (ch === "]" || ch === "P" || ch === "_" || ch === "^" || ch === "X") {
					this.esc = 4; // string-terminated (OSC/DCS/APC/PM/SOS)
				}
				continue;
			}

			// State 0: normal — check for ESC start
			if (code === 0x1b) {
				this.esc = 1;
				continue;
			}

			// ── Command buffer tracking ──
			if (this.inPaste) continue;

			if (ch === "\r") {
				const name = this.buf.trim();
				result = name || null;
				this.buf = "";
			} else if (code === 0x7f || code === 0x08) {
				this.buf = this.buf.slice(0, -1);
			} else if (code === 0x03) {
				this.buf = "";
			} else if (code >= 0x20 && this.buf.length < MAX_BUF) {
				this.buf += ch;
			}
		}

		return result;
	}
}
