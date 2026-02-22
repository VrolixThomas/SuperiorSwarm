import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useTerminalStore } from "../stores/terminal";

export function Terminal({ id }: { id: string }) {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!ref.current) return;

		const rootStyles = getComputedStyle(document.documentElement);
		const bg = rootStyles.getPropertyValue("--bg-base").trim();
		const fg = rootStyles.getPropertyValue("--text").trim();

		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: 13,
			fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
			lineHeight: 1.2,
			scrollback: 10000,
			theme: {
				background: bg,
				foreground: fg,
				cursor: fg,
				cursorAccent: bg,
				selectionBackground: "rgba(255, 255, 255, 0.15)",
				black: "#1a1a1a",
				red: "#ff6b6b",
				green: "#69db7c",
				yellow: "#ffd43b",
				blue: "#74c0fc",
				magenta: "#da77f2",
				cyan: "#66d9e8",
				white: "#e5e5e5",
				brightBlack: "#555",
				brightRed: "#ff8787",
				brightGreen: "#8ce99a",
				brightYellow: "#ffe066",
				brightBlue: "#a5d8ff",
				brightMagenta: "#e599f7",
				brightCyan: "#99e9f2",
				brightWhite: "#ffffff",
			},
		});

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new SearchAddon());
		term.loadAddon(new WebLinksAddon());
		term.loadAddon(new ClipboardAddon());

		const unicode11 = new Unicode11Addon();
		term.loadAddon(unicode11);
		term.unicode.activeVersion = "11";

		term.open(ref.current);

		// WebGL: load after open(), fall back on any failure
		try {
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl.dispose());
			term.loadAddon(webgl);
		} catch {
			console.warn("WebGL2 not available, using default renderer");
		}

		// ImageAddon: must load after open() and after the renderer addon
		term.loadAddon(new ImageAddon());

		requestAnimationFrame(() => fit.fit());

		// Wire up PTY if running inside Electron
		const api = window.electron;
		let cleanupData: (() => void) | undefined;
		let cleanupExit: (() => void) | undefined;

		if (api) {
			api.terminal.create(id).catch((err: Error) => {
				console.error("Failed to create PTY:", err);
				term.write(`\r\n\x1b[31m[Failed to create terminal: ${err.message}]\x1b[0m\r\n`);
			});

			// Shift+Enter: send \n (LF) instead of \r (CR) for multiline editing
			// in raw-mode applications (Claude Code, fish, zsh, etc.)
			term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
				if (event.type !== "keydown") return true;
				if (
					event.key === "Enter" &&
					event.shiftKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.metaKey
				) {
					api.terminal.write(id, "\n");
					return false;
				}
				return true;
			});

			cleanupData = api.terminal.onData(id, (data) => {
				term.write(data);
			});

			cleanupExit = api.terminal.onExit(id, (code) => {
				term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
			});

			const MAX_TITLE = 48;
			const truncTitle = (t: string) => (t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)}…` : t);
			const setTitle = (title: string) => useTerminalStore.getState().updateTabTitle(id, title);

			// onTitleChange fires when the shell sends OSC 0/2 (fish, oh-my-zsh, etc.).
			// When active, it takes priority over the command-buffer heuristic.
			let oscTitleAt = 0;
			term.onTitleChange((title) => {
				if (title) {
					oscTitleAt = Date.now();
					setTitle(truncTitle(title));
				}
			});

			// Command-buffer heuristic: tracks user keystrokes to derive a tab title
			// for shells that don't emit OSC titles (vanilla zsh/bash on macOS).
			let cmdBuf = "";
			// Escape parser states:
			// 0 = normal, 1 = after ESC, 2 = in CSI (params/intermediates),
			// 3 = in SS3, 4 = in string-terminated sequence (OSC/DCS/APC),
			// 5 = saw ESC inside string-terminated (looking for backslash to end)
			let esc: 0 | 1 | 2 | 3 | 4 | 5 = 0;
			let csiFinished = ""; // tracks the last CSI final params for bracket-paste detection
			let inPaste = false;

			term.onData((data) => {
				api.terminal.write(id, data);

				// Skip buffering when in alternate screen (vim, less, etc.)
				if (term.buffer.active.type === "alternate") return;

				for (const ch of data) {
					const code = ch.charCodeAt(0);

					// ── Escape sequence state machine ──
					// Consumes full sequences so they never pollute cmdBuf.

					// State 5: inside string-terminated body, saw ESC — check for backslash (ST)
					if (esc === 5) {
						esc = code === 0x5c /* \ */ ? 0 : 4;
						continue;
					}

					// State 4: inside string-terminated body (OSC/DCS/APC) — consume until ST or BEL
					if (esc === 4) {
						if (code === 0x1b)
							esc = 5; // might be ST (ESC \)
						else if (code === 0x07) esc = 0; // BEL terminates OSC
						continue;
					}

					// State 3: SS3 — consume one final byte (0x40-0x7E) then done
					if (esc === 3) {
						// Some terminals send params before the final byte; consume those too
						if (code >= 0x30 && code <= 0x3f) continue;
						esc = 0;
						continue;
					}

					// State 2: CSI — consume param bytes (0x30-0x3F), intermediates (0x20-0x2F),
					// then final byte (0x40-0x7E)
					if (esc === 2) {
						if (code >= 0x30 && code <= 0x3f) {
							csiFinished += ch;
							continue;
						}
						if (code >= 0x20 && code <= 0x2f) continue; // intermediate bytes
						if (code >= 0x40 && code <= 0x7e) {
							// Detect bracketed paste boundaries
							if (ch === "~") {
								if (csiFinished === "200") inPaste = true;
								else if (csiFinished === "201") {
									inPaste = false;
									cmdBuf = ""; // discard pasted text from buffer
								}
							}
							csiFinished = "";
							esc = 0;
						}
						continue;
					}

					// State 1: after ESC — determine which family
					if (esc === 1) {
						esc = 0;
						if (ch === "[") {
							esc = 2;
							csiFinished = "";
						} else if (ch === "O") {
							esc = 3; // SS3
						} else if (ch === "]" || ch === "P" || ch === "_" || ch === "^" || ch === "X") {
							esc = 4; // string-terminated (OSC/DCS/APC/PM/SOS)
						} else if (ch === "N") {
							esc = 3; // SS2 — same shape as SS3 (consume one byte)
						}
						// For Alt+<key> (ESC + printable) or bare ESC, the byte is consumed here
						continue;
					}

					// State 0: normal — check for ESC start
					if (code === 0x1b) {
						esc = 1;
						continue;
					}

					// ── Command buffer tracking ──
					if (inPaste) continue;

					if (ch === "\r") {
						const name = cmdBuf.trim();
						if (name) {
							// Only update title if no OSC title was received in the last second
							const elapsed = Date.now() - oscTitleAt;
							if (elapsed > 1000) setTitle(truncTitle(name));
						}
						cmdBuf = "";
					} else if (code === 0x7f || code === 0x08) {
						cmdBuf = cmdBuf.slice(0, -1);
					} else if (code === 0x03) {
						cmdBuf = "";
					} else if (code >= 0x20) {
						cmdBuf += ch;
					}
				}
			});

			term.onResize(({ cols, rows }) => api.terminal.resize(id, cols, rows));
			api.terminal.resize(id, term.cols, term.rows);
		}

		// Resize handling
		const onResize = () => fit.fit();
		window.addEventListener("resize", onResize);
		const observer = new ResizeObserver(() => requestAnimationFrame(() => fit.fit()));
		observer.observe(ref.current);

		return () => {
			cleanupData?.();
			cleanupExit?.();
			window.removeEventListener("resize", onResize);
			observer.disconnect();
			api?.terminal.dispose(id);
			term.dispose();
		};
	}, [id]);

	return <div ref={ref} className="xterm-container" />;
}
