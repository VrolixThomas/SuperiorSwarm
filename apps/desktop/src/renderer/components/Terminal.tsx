import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { CmdBuffer } from "../../shared/lib/cmd-buffer";
import { useTabStore } from "../stores/tab-store";
import { interceptPaste } from "./terminal-paste";

function buildTerminalTheme(): ITheme {
	const s = getComputedStyle(document.documentElement);
	const v = (name: string) => s.getPropertyValue(name).trim();
	return {
		background: v("--bg-base"),
		foreground: v("--text"),
		cursor: v("--text"),
		cursorAccent: v("--bg-base"),
		selectionBackground: v("--term-selection"),
		black: v("--term-black"),
		red: v("--term-red"),
		green: v("--term-green"),
		yellow: v("--term-yellow"),
		blue: v("--term-blue"),
		magenta: v("--term-magenta"),
		cyan: v("--term-cyan"),
		white: v("--term-white"),
		brightBlack: v("--term-bright-black"),
		brightRed: v("--term-bright-red"),
		brightGreen: v("--term-bright-green"),
		brightYellow: v("--term-bright-yellow"),
		brightBlue: v("--term-bright-blue"),
		brightMagenta: v("--term-bright-magenta"),
		brightCyan: v("--term-bright-cyan"),
		brightWhite: v("--term-bright-white"),
	};
}

export function formatTerminalExitMessage(code: number): string {
	if (code === -1) {
		return "\r\n\x1b[31m[Terminal session lost]\x1b[0m\r\n\x1b[90mConnection to the terminal daemon was interrupted and this session cannot be resumed.\r\nOpen a new terminal tab to continue.\x1b[0m\r\n";
	}

	return `\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`;
}

export function Terminal({
	id,
	cwd,
	workspaceId,
	initialContent,
}: { id: string; cwd?: string; workspaceId?: string; initialContent?: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const cwdRef = useRef(cwd);
	const initialContentRef = useRef(initialContent);
	const workspaceIdRef = useRef(workspaceId);
	cwdRef.current = cwd;
	initialContentRef.current = initialContent;
	workspaceIdRef.current = workspaceId;

	useEffect(() => {
		if (!ref.current) return;

		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: 13,
			fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
			lineHeight: 1.2,
			scrollback: 10000,
			theme: buildTerminalTheme(),
		});

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new SearchAddon());
		term.loadAddon(
			new WebLinksAddon((_event, uri) => {
				window.electron.shell.openExternal(uri);
			})
		);
		term.loadAddon(new ClipboardAddon());

		const unicode11 = new Unicode11Addon();
		term.loadAddon(unicode11);
		term.unicode.activeVersion = "11";

		term.open(ref.current);

		// WebGL: load after open(), fall back on any failure
		let webgl: WebglAddon | null = null;
		try {
			webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl?.dispose());
			term.loadAddon(webgl);
		} catch {
			console.warn("WebGL2 not available, using default renderer");
		}

		// ImageAddon: must load after open() and after the renderer addon
		term.loadAddon(new ImageAddon());

		// Reactive theme: watch for CSS variable changes (theme toggle, OS dark/light)
		let rafId = 0;
		const applyTheme = () => {
			rafId = 0;
			term.options.theme = buildTerminalTheme();
			// WebGL renderer caches GPU textures keyed to the old theme; re-init forces fresh paint.
			if (webgl) {
				try {
					webgl.dispose();
					webgl = new WebglAddon();
					webgl.onContextLoss(() => webgl?.dispose());
					term.loadAddon(webgl);
				} catch {
					// If re-init fails, fall through — DOM renderer takes over.
					webgl = null;
				}
			}
			term.refresh(0, term.rows - 1);
		};
		const scheduleTheme = () => {
			if (!rafId) rafId = requestAnimationFrame(applyTheme);
		};

		const themeObserver = new MutationObserver(scheduleTheme);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		requestAnimationFrame(() => fit.fit());

		// Wire up PTY if running inside Electron
		const api = window.electron;
		let cleanupData: (() => void) | undefined;
		let cleanupExit: (() => void) | undefined;
		let cleanupPaste: (() => void) | undefined;

		if (api) {
			api.terminal
				.create(id, cwdRef.current || undefined, workspaceIdRef.current)
				.then(({ wasAttached }) => {
					// Only replay saved scrollback for fresh sessions.
					// Attached sessions (live background PTYs) send their current buffer
					// via onData — writing initialContent too would stack old content
					// before the live buffer and misplace the cursor inside TUI apps.
					if (!wasAttached && initialContentRef.current) {
						term.write(initialContentRef.current);
					}
				})
				.catch((err: Error) => {
					console.error("Failed to create PTY:", err);
					term.write(
						`\r\n\x1b[31m[Terminal daemon is unavailable]\x1b[0m\r\n\x1b[90mThe background terminal daemon could not be reached.\r\nReconnection will be attempted automatically.\r\nError: ${err.message}\x1b[0m\r\n`
					);
				});

			// Shift+Enter: send CSI u sequence for multiline editing
			// in raw-mode applications (Claude Code, fish, zsh, etc.).
			// We suppress both keydown and keyup to prevent xterm from
			// also emitting \r through its onData path.
			let shiftEnterPending = false;
			term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
				if (
					event.key === "Enter" &&
					event.shiftKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.metaKey
				) {
					if (event.type === "keydown") {
						shiftEnterPending = true;
						api.terminal.write(id, "\x1b[13;2u");
					}
					return false;
				}
				return true;
			});

			cleanupData = api.terminal.onData(id, (data) => {
				term.write(data);
			});

			cleanupExit = api.terminal.onExit(id, (code) => {
				term.write(formatTerminalExitMessage(code));
			});

			const MAX_TITLE = 48;
			const truncTitle = (t: string) => (t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE)}…` : t);
			const setTitle = (title: string) => useTabStore.getState().updateTabTitle(id, title);

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
			const cmd = new CmdBuffer();

			term.onData((data) => {
				// Suppress the \r that xterm may still emit after our
				// Shift+Enter handler already sent the CSI u sequence.
				if (shiftEnterPending) {
					shiftEnterPending = false;
					if (data === "\r") return;
				}
				api.terminal.write(id, data);
				if (term.buffer.active.type === "alternate") return;

				const name = cmd.feed(data);
				if (name && Date.now() - oscTitleAt > 1000) {
					setTitle(truncTitle(name));
				}
			});

			term.onResize(({ cols, rows }) => api.terminal.resize(id, cols, rows));
			api.terminal.resize(id, term.cols, term.rows);
			cleanupPaste = interceptPaste(term, (data) => api.terminal.write(id, data));
		}

		// Resize handling
		const onResize = () => fit.fit();
		window.addEventListener("resize", onResize);
		const observer = new ResizeObserver(() => requestAnimationFrame(() => fit.fit()));
		observer.observe(ref.current);

		return () => {
			cleanupData?.();
			cleanupExit?.();
			cleanupPaste?.();
			window.removeEventListener("resize", onResize);
			observer.disconnect();
			themeObserver.disconnect();
			if (rafId) cancelAnimationFrame(rafId);
			api?.terminal.detach(id);
			webgl?.dispose();
			term.dispose();
		};
	}, [id]);

	return <div ref={ref} className="xterm-container" />;
}
