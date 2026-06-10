// Sequences written into xterm (never into the PTY) to clear terminal modes a
// dead TUI left behind. Covers every mouse protocol (DECSET 9/1000/1002/1003 and
// the 1005/1006/1015/1016 encodings), focus reporting (1004, emits ESC[I/ESC[O junk),
// and restores cursor visibility. Deliberately leaves bracketed paste (2004)
// alone — shells arm it per-prompt — and alt screen (1049), which callers exit
// conditionally to avoid clobbering a saved cursor on the normal buffer.
export const RESET_STALE_MODES =
	"\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l\x1b[?1004l\x1b[?25h";

const SHELLS = new Set([
	"zsh",
	"bash",
	"fish",
	"sh",
	"dash",
	"nu",
	"pwsh",
	"tcsh",
	"csh",
	"ksh",
]);

// node-pty's IPty.process reports the PTY's current foreground process name
// (e.g. "zsh", "-zsh" for login shells, sometimes a full path). A shell in the
// foreground means no TUI owns the terminal, so stale modes are safe to reset.
export function isShellProcess(name: string | undefined): boolean {
	if (!name) return false;
	const base = name.slice(name.lastIndexOf("/") + 1).replace(/^-/, "");
	return SHELLS.has(base.toLowerCase());
}
