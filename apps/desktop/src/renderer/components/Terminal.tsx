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
import type { TerminalDataMeta } from "../../shared/daemon-protocol";
import { CmdBuffer } from "../../shared/lib/cmd-buffer";
import { RESET_STALE_MODES, isShellProcess } from "../../shared/lib/terminal-modes";
import { TERMINAL_SCROLLBACK_LINES } from "../../shared/terminal-replay";
import { useTabStore } from "../stores/tab-store";
import { readTerminalDiagnostics, registerTerminalDiagnostics } from "./terminal-diagnostics";
import { installTerminalInput } from "./terminal-input";
import { createTerminalLinkHandler } from "./terminal-links";
import { interceptPaste } from "./terminal-paste";
import { writeTerminalReplay } from "./terminal-replay";
import { TERMINAL_SCROLL_OPTIONS, installTerminalWheelHandler } from "./terminal-wheel";

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
	const [viewRevision, setViewRevision] = useState(0);
	const [recovery, setRecovery] = useState<{
		reason:
			| NonNullable<TerminalDataMeta["recovery"]>
			| "restore-failed"
			| "input-failed"
			| "old-input";
		resumeCommand?: string;
	} | null>(null);
	const [recoveryAction, setRecoveryAction] = useState("");
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
			scrollback: TERMINAL_SCROLLBACK_LINES,
			...TERMINAL_SCROLL_OPTIONS,
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
		const cleanupWheel = installTerminalWheelHandler(ref.current, term, () => activeRef.current);

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
			if (disposed) return;
			if (suppressDepth === 0) fit.fit();
			term.focus();
		});

		// Replay gate: while attach/restore scrollback is parsed, xterm re-emits
		// answers to replayed device queries (DA/DSR) and replayed DECSET sequences
		// re-arm mouse reporting. None of that may reach the PTY — the app that
		// asked already got its answers when the bytes were live.
		// Counter (not boolean) so back-to-back replay chunks can't clear each other's gate.
		let suppressDepth = 0;
		let replayStartedAt = 0;
		const restores = new Set<() => void>();
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
				resolve: (batchId, ids) =>
					trpcVanilla.terminalFiles.resolve.mutate({ batchId, ids, submit: false }),
				insert: (batchId, text, payload) =>
					trpcVanilla.terminalFiles.insert.mutate({ batchId, text, payload, submit: false }),
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
							void files
								.stage(window.electron.terminalFiles.nativePaths(dropped))
								.then(() => files.focusInput());
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

		const restore = (data: string, clearModes: boolean) => {
			suppressDepth++;
			replayStartedAt ||= Date.now();
			let finished = false;
			let cancel = () => {};
			cancel = writeTerminalReplay(term, data, (error) => {
				finished = true;
				restores.delete(cancel);
				suppressDepth--;
				if (suppressDepth === 0) replayStartedAt = 0;
				if (disposed) return;
				try {
					if (error) throw error;
					if (clearModes) resetStaleModes();
					if (suppressDepth === 0) fit.fit();
				} catch {
					setRecovery({ reason: "restore-failed" });
				}
			});
			if (!finished) restores.add(cancel);
		};
		const cleanupDiagnostics = registerTerminalDiagnostics(id, async () => ({
			id,
			viewRevision,
			buffer: term.buffer.active.type,
			baseY: term.buffer.active.baseY,
			normalBaseY: term.buffer.normal.baseY,
			viewportY: term.buffer.active.viewportY,
			mouse: term.modes.mouseTrackingMode,
			cols: term.cols,
			rows: term.rows,
			visible: activeRef.current,
			replayDepth: suppressDepth,
			replayAgeMs: replayStartedAt ? Date.now() - replayStartedAt : 0,
			transport: await window.electron.terminal.diagnostics(id),
		}));

		// Wire up PTY if running inside Electron
		const api = window.electron;
		let cleanupData: (() => void) | undefined;
		let cleanupExit: (() => void) | undefined;
		let cleanupPaste: (() => void) | undefined;
		let cleanupInput: (() => void) | undefined;

		if (api) {
			const inputFailed = async (binary: boolean) => {
				const status = binary ? await api.terminal.diagnostics(id).catch(() => null) : null;
				if (disposed) return;
				const reason = status?.connected && !status.binaryInput ? "old-input" : "input-failed";
				setRecovery((current) => (current?.reason === reason ? current : { reason }));
			};
			const sendInput = (data: string, binary = false) => {
				const result = binary ? api.terminal.writeBinary(id, data) : api.terminal.write(id, data);
				void result.then(
					(accepted) => {
						if (!accepted) void inputFailed(binary);
					},
					() => {
						void inputFailed(binary);
					}
				);
			};
			api.terminal
				.create(id, cwdRef.current || undefined, workspaceId)
				.then(({ wasAttached }) => {
					if (disposed) return;
					created = true;
					// Only replay saved scrollback for fresh sessions.
					// Attached sessions (live background PTYs) send their current buffer
					// via onData — writing initialContent too would stack old content
					// before the live buffer and misplace the cursor inside TUI apps.
					if (!wasAttached && initialContentRef.current) restore(initialContentRef.current, true);
				})
				.catch((err: Error) => {
					if (disposed) return;
					setRecovery({ reason: "restore-failed" });
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
					files.shouldHandleEnter()
				) {
					event.preventDefault();
					if (event.type === "keydown" && !event.repeat) {
						fileEnterPending = true;
						// Consume this Enter to insert paths. A later Enter with no pending files
						// follows xterm's ordinary input path and submits the completed draft.
						void files.insertPending();
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
						sendInput("\x1b[13;2u");
					}
					return false;
				}
				return true;
			});

			cleanupData = api.terminal.onData(id, (data, meta) => {
				if (meta?.replay) {
					files.suspend();
					setRecovery(
						meta.recovery ? { reason: meta.recovery, resumeCommand: meta.resumeCommand } : null
					);
					setRecoveryAction("");
					restore(data, isShellProcess(meta.fg));
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

			cleanupInput = installTerminalInput(
				term,
				() => suppressDepth > 0,
				(data) => {
					if (filePaste.capture(data)) return;
					if (/[\r\n]/.test(data)) files.suspend();
					// Suppress the \r that xterm may still emit after our
					// Shift+Enter handler already sent the CSI u sequence.
					if (shiftEnterPending) {
						shiftEnterPending = false;
						if (data === "\r") return;
					}
					sendInput(data);
					if (term.buffer.active.type === "alternate") return;

					const name = cmd.feed(data);
					if (name && Date.now() - oscTitleAt > 1000) {
						setTitle(truncTitle(name));
					}
				},
				(data) => {
					sendInput(data, true);
				}
			);

			term.onResize(({ cols, rows }) => {
				// Snapshot dimensions are temporary and must never resize the live PTY.
				if (suppressDepth === 0) api.terminal.resize(id, cols, rows);
			});
			api.terminal.resize(id, term.cols, term.rows);
			cleanupPaste = interceptPaste(term, (data) => sendInput(data));
		}

		// Resize handling
		const onResize = () => {
			if (!disposed && suppressDepth === 0) fit.fit();
		};
		window.addEventListener("resize", onResize);
		const observer = new ResizeObserver(() => requestAnimationFrame(onResize));
		observer.observe(ref.current);

		return () => {
			disposed = true;
			cleanupDiagnostics();
			for (const cancel of restores) cancel();
			files.suspend();
			controllerRef.current = null;
			cleanupDrop?.();
			cleanupConnection?.();
			host?.removeEventListener("keydown", escapeFiles, true);
			cleanupData?.();
			cleanupExit?.();
			cleanupPaste?.();
			cleanupInput?.();
			cleanupWheel();
			window.removeEventListener("resize", onResize);
			observer.disconnect();
			themeObserver.disconnect();
			if (rafId) cancelAnimationFrame(rafId);
			api?.terminal.detach(id);
			webgl?.dispose();
			term.dispose();
		};
	}, [id, workspaceId, viewRevision]);

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
			{recovery && (
				<div
					aria-live="polite"
					className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]"
				>
					<span>
						{recovery.reason === "legacy-replay"
							? "This restored chat may be missing history. If scrolling is stuck, finish the current task, then resume the chat."
							: recovery.reason === "old-input"
								? "This older session cannot receive mouse input. Finish and close the older terminal sessions, then reopen the app."
								: recovery.reason === "input-failed"
									? "Input could not be delivered. Reload the view before trying again."
									: "The terminal view could not keep up or finish restoring. Reload the view to reconnect."}
					</span>
					{recovery.resumeCommand && (
						<button
							className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-elevated)] focus-visible:outline-2"
							type="button"
							onClick={() => {
								void navigator.clipboard.writeText(recovery.resumeCommand ?? "").then(
									() =>
										setRecoveryAction(
											"Resume command copied. Run it after exiting the current agent."
										),
									() => setRecoveryAction("Could not copy the resume command.")
								);
							}}
						>
							Copy resume command
						</button>
					)}
					{recovery.reason !== "legacy-replay" && recovery.reason !== "old-input" && (
						<button
							className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-elevated)] focus-visible:outline-2"
							type="button"
							onClick={() => setViewRevision((value) => value + 1)}
						>
							Reload view
						</button>
					)}
					<button
						className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-elevated)] focus-visible:outline-2"
						type="button"
						onClick={() => {
							void readTerminalDiagnostics(id)
								.then((data) => navigator.clipboard.writeText(JSON.stringify(data, null, 2)))
								.then(
									() => setRecoveryAction("Diagnostics copied."),
									() => setRecoveryAction("Could not copy diagnostics.")
								);
						}}
					>
						Copy diagnostics
					</button>
					<button
						className="rounded border border-[var(--border)] px-2 py-1 hover:bg-[var(--bg-elevated)] focus-visible:outline-2"
						type="button"
						onClick={() => setRecovery(null)}
					>
						Dismiss
					</button>
					{recoveryAction && <span>{recoveryAction}</span>}
				</div>
			)}
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
