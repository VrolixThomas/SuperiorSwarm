import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { CmdBuffer } from "../../shared/lib/cmd-buffer";
import { useTerminalStore } from "../stores/terminal";

// Global registry: maps tab id → serialize function
// Used by the session save logic to collect scrollback from all mounted terminals
export const scrollbackRegistry = new Map<string, () => string>();

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

export function Terminal({
	id,
	cwd,
	initialContent,
}: { id: string; cwd?: string; initialContent?: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const cwdRef = useRef(cwd);
	const initialContentRef = useRef(initialContent);
	cwdRef.current = cwd;
	initialContentRef.current = initialContent;

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

		// SerializeAddon: for session persistence
		const serialize = new SerializeAddon();
		term.loadAddon(serialize);

		const MAX_SCROLLBACK_CHARS = 50_000;
		const MAX_SCROLLBACK_ROWS = 200;

		// Strip the last line from serialized content. The last line is always
		// the shell prompt, which the new PTY will reproduce on its own.
		// Without this, each app restart accumulates an extra prompt line.
		const trimPromptLine = (content: string): string => {
			const lastNewline = content.lastIndexOf("\n");
			return lastNewline >= 0 ? content.slice(0, lastNewline + 1) : "";
		};

		// Capture the "clean" normal-buffer state right before a TUI enters
		// the alternate buffer so periodic saves don't lose pre-TUI history.
		let preAltSnapshot = "";
		term.buffer.onBufferChange(() => {
			if (term.buffer.active.type === "alternate") {
				preAltSnapshot = trimPromptLine(
					serialize.serialize({
						excludeAltBuffer: true,
						excludeModes: true,
						scrollback: MAX_SCROLLBACK_ROWS,
					})
				);
			}
		});

		scrollbackRegistry.set(id, () => {
			// While a TUI is active, return the pre-TUI snapshot
			if (term.buffer.active.type === "alternate") {
				return preAltSnapshot;
			}

			const content = trimPromptLine(
				serialize.serialize({
					excludeAltBuffer: true,
					excludeModes: true,
					scrollback: MAX_SCROLLBACK_ROWS,
				})
			);
			if (content.length > MAX_SCROLLBACK_CHARS) {
				return content.slice(content.length - MAX_SCROLLBACK_CHARS);
			}
			return content;
		});

		// Reactive theme: watch for CSS variable changes (theme toggle, OS dark/light)
		let rafId = 0;
		const applyTheme = () => {
			rafId = 0;
			term.options.theme = buildTerminalTheme();
		};
		const scheduleTheme = () => {
			if (!rafId) rafId = requestAnimationFrame(applyTheme);
		};

		const themeObserver = new MutationObserver(scheduleTheme);
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style", "data-theme"],
		});

		const mql = matchMedia("(prefers-color-scheme: dark)");
		mql.addEventListener("change", scheduleTheme);

		requestAnimationFrame(() => fit.fit());

		// Replay saved scrollback content before connecting PTY
		if (initialContentRef.current) {
			term.write(initialContentRef.current);
		}

		// Wire up PTY if running inside Electron
		const api = window.electron;
		let cleanupData: (() => void) | undefined;
		let cleanupExit: (() => void) | undefined;

		if (api) {
			api.terminal.create(id, cwdRef.current || undefined).catch((err: Error) => {
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
			const cmd = new CmdBuffer();

			term.onData((data) => {
				api.terminal.write(id, data);
				if (term.buffer.active.type === "alternate") return;

				const name = cmd.feed(data);
				if (name && Date.now() - oscTitleAt > 1000) {
					setTitle(truncTitle(name));
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
			themeObserver.disconnect();
			mql.removeEventListener("change", scheduleTheme);
			if (rafId) cancelAnimationFrame(rafId);
			scrollbackRegistry.delete(id);
			api?.terminal.dispose(id);
			term.dispose();
		};
	}, [id]);

	return <div ref={ref} className="xterm-container" />;
}
