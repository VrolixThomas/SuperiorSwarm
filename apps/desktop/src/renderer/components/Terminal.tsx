import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import type { ITheme } from "@xterm/xterm";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { CmdBuffer } from "../../shared/lib/cmd-buffer";
import { RESET_STALE_MODES, isShellProcess } from "../../shared/lib/terminal-modes";
import { useTabStore } from "../stores/tab-store";
import { createTerminalLinkHandler } from "./terminal-links";
import { interceptPaste } from "./terminal-paste";

import { trpcVanilla } from "../trpc/client";
import { TerminalFileShelf } from "./TerminalFileShelf";
import { type FileShelfState, TerminalFileController } from "./terminal-file-controller";
import { TerminalFileDraftStore } from "./terminal-file-draft";
import { collectFilePaste, installFileDrop } from "./terminal-file-drop";

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
	active,
}: {
	id: string;
	cwd?: string;
	workspaceId?: string;
	initialContent?: string;
	active: boolean;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const hostRef = useRef<HTMLDivElement>(null);
	const activeRef = useRef(active);
	activeRef.current = active;
	const controllerRef = useRef<TerminalFileController | null>(null);
	const [controller, setController] = useState<TerminalFileController | null>(null);
	const [fileState, setFileState] = useState<FileShelfState>({
		batch: null,
		busy: false,
		status: "",
	});
	const [dragging, setDragging] = useState(false);
	const stageFiles = (files: File[]) => {
		try {
			void controllerRef.current?.stage(window.electron.terminalFiles.nativePaths(files));
			controllerRef.current?.focusInput();
		} catch (error) {
			controllerRef.current?.reportError(
				error instanceof Error ? error.message : "Unable to resolve local files."
			);
		}
	};
	const cwdRef = useRef(cwd);
	const initialContentRef = useRef(initialContent);
	cwdRef.current = cwd;
	initialContentRef.current = initialContent;

	useEffect(() => {
		if (!ref.current) return;

		const openExternalLink = createTerminalLinkHandler((url) =>
			window.electron.shell.openExternal(url)
		);
		const term = new XTerm({
			allowProposedApi: true,
			cursorBlink: true,
			fontSize: 13,
			fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
			lineHeight: 1.2,
			// Codex emits OSC 8 hyperlinks, while WebLinksAddon handles plain-text URLs.
			linkHandler: {
				activate: openExternalLink,
			},
			scrollback: 10000,
			theme: buildTerminalTheme(),
		});

		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new SearchAddon());
		term.loadAddon(new WebLinksAddon(openExternalLink));
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

		requestAnimationFrame(() => {
			fit.fit();
			term.focus();
		});

		// Replay gate: while attach/restore scrollback is parsed, xterm re-emits
		// answers to replayed device queries (DA/DSR) and replayed DECSET sequences
		// re-arm mouse reporting. None of that may reach the PTY — the app that
		// asked already got its answers when the bytes were live.
		// Counter (not boolean) so back-to-back replay chunks can't clear each other's gate.
		let suppressDepth = 0;
		let connected = true;
		let created = false;
		let disposed = false;
		const filePaste = collectFilePaste();
		let draftStore: TerminalFileDraftStore | null = null;
		try {
			if (workspaceId)
				draftStore = new TerminalFileDraftStore(window.localStorage, workspaceId, id);
		} catch {
			/* Some environments disable local storage. */
		}
		const savedSelection = draftStore?.load();
		const files = new TerminalFileController(
			{
				prepare: (paths) => trpcVanilla.terminalFiles.prepare.mutate({ terminalId: id, paths }),
				append: (batchId, paths, retainedIds) =>
					trpcVanilla.terminalFiles.append.mutate({ batchId, paths, retainedIds }),
				resolve: (batchId, ids, submit) =>
					trpcVanilla.terminalFiles.resolve.mutate({ batchId, ids, submit }),
				insert: (batchId, text, payload, submit) =>
					trpcVanilla.terminalFiles.insert.mutate({ batchId, text, payload, submit }),
				copy: (batchId, id) => trpcVanilla.terminalFiles.copy.mutate({ batchId, id }),
				copyPaths: (batchId, ids) => trpcVanilla.terminalFiles.copyPaths.mutate({ batchId, ids }),
				clipboard: (text) => navigator.clipboard.writeText(text),
				cancel: (batchId) => trpcVanilla.terminalFiles.cancel.mutate({ batchId }),
				ready: () => !disposed && created && connected && activeRef.current && suppressDepth === 0,
				paste: (text) => filePaste.paste(term, text),
				focus: () => {
					suppressDepth++;
					try {
						term.focus();
					} finally {
						suppressDepth--;
					}
				},
			},
			(state) => {
				const saved = draftStore?.save(state.batch) ?? true;
				if (!disposed)
					setFileState(
						!saved && state.batch
							? {
									...state,
									status:
										"Files are selected, but cannot be retained across refresh in this window.",
								}
							: state
					);
			}
		);
		if (savedSelection) files.restore(savedSelection);
		else setFileState(files.state);
		controllerRef.current = files;
		setController(files);
		const cleanupDrop = hostRef.current
			? installFileDrop(
					hostRef.current,
					(dropped) => {
						try {
							void files.stage(window.electron.terminalFiles.nativePaths(dropped));
						} catch (error) {
							files.reportError(
								error instanceof Error ? error.message : "Unable to resolve files."
							);
						}
					},
					setDragging,
					(message) => files.reportError(message)
				)
			: undefined;
		const escapeFiles = (event: KeyboardEvent) => {
			if (event.key === "Escape" && (files.state.batch || files.state.busy)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				files.clear();
			}
		};
		const host = hostRef.current;
		host?.addEventListener("keydown", escapeFiles, true);
		const cleanupConnection = window.electron?.daemon.onStatus((value) => {
			connected = value;
			files.suspend("Connection changed. Files are kept; review the prompt before sending.");
		});

		const resetStaleModes = () => {
			// Written into xterm only — never the PTY.
			if (term.buffer.active.type === "alternate") {
				term.write("\x1b[?1049l");
			}
			term.write(RESET_STALE_MODES);
		};

		// Wire up PTY if running inside Electron
		const api = window.electron;
		let cleanupData: (() => void) | undefined;
		let cleanupExit: (() => void) | undefined;
		let cleanupPaste: (() => void) | undefined;

		if (api) {
			api.terminal
				.create(id, cwdRef.current || undefined, workspaceId)
				.then(({ wasAttached }) => {
					if (disposed) return;
					created = true;
					// Only replay saved scrollback for fresh sessions.
					// Attached sessions (live background PTYs) send their current buffer
					// via onData — writing initialContent too would stack old content
					// before the live buffer and misplace the cursor inside TUI apps.
					if (!wasAttached && initialContentRef.current) {
						suppressDepth++;
						term.write(initialContentRef.current, () => {
							suppressDepth--;
							// Fresh PTY: the saved scrollback's app is gone by definition.
							resetStaleModes();
						});
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
			let fileEnterPending = false;
			term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
				if (event.key === "Enter" && fileEnterPending) {
					if (event.type === "keydown" && !event.repeat) {
						// Focus can move before keyup; a new physical press must still work.
						fileEnterPending = false;
					} else {
						if (event.type === "keyup") fileEnterPending = false;
						event.preventDefault();
						return false;
					}
				}
				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.metaKey &&
					!event.isComposing &&
					files.hasFilesForSubmit()
				) {
					event.preventDefault();
					if (event.type === "keydown" && !event.repeat) {
						fileEnterPending = true;
						void files.submit();
					}
					return false;
				}
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

			cleanupData = api.terminal.onData(id, (data, meta) => {
				if (meta?.replay) {
					files.suspend();
					suppressDepth++;
					term.write(data, () => {
						suppressDepth--;
						// Shell in the foreground means whatever set those modes is gone.
						if (isShellProcess(meta.fg)) {
							resetStaleModes();
						}
					});
				} else {
					term.write(data);
				}
			});

			cleanupExit = api.terminal.onExit(id, (code) => {
				created = false;
				files.clear("Terminal closed. Pending paths discarded.");
				// Empty write = barrier: the buffer check inside resetStaleModes must
				// run after any still-queued replay chunk has parsed.
				term.write("", () => {
					resetStaleModes();
					term.write(formatTerminalExitMessage(code));
				});
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
				if (filePaste.capture(data)) return;
				if (suppressDepth > 0) return;
				if (/[\r\n]/.test(data)) files.suspend();
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
			disposed = true;
			files.suspend();
			controllerRef.current = null;
			cleanupDrop?.();
			cleanupConnection?.();
			host?.removeEventListener("keydown", escapeFiles, true);
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
	}, [id, workspaceId]);

	useEffect(() => {
		if (!active) {
			controllerRef.current?.suspend();
			setDragging(false);
		}
		void window.electron?.terminal.setVisible(id, active);
		return () => {
			void window.electron?.terminal.setVisible(id, false);
		};
	}, [active, id]);

	return (
		<div ref={hostRef} className="relative flex h-full min-h-0 flex-col">
			<div className="min-h-0 flex-1">
				<div ref={ref} className="xterm-container" />
			</div>
			{dragging && (
				<output
					aria-live="polite"
					className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded border-2 border-dashed border-[var(--accent)] bg-[var(--bg-base)] text-sm"
				>
					Drop files to add to your message
				</output>
			)}
			<TerminalFileShelf
				key={`${id}:${workspaceId}`}
				terminalId={id}
				controller={controller}
				state={fileState}
				onFiles={stageFiles}
			/>
		</div>
	);
}
