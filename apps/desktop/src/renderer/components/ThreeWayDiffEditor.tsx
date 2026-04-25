import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ConflictType } from "../../shared/branch-types";
import { detectLanguage } from "../../shared/diff-types";
import { shouldSkipShortcutHandling } from "../hooks/useShortcutListener";
import { ensureThemeRegistered } from "../lib/monacoTheme";
import {
	type MergeHunk,
	computeSideDiffs,
	computeThreeWayMerge,
	resetHunkCounter,
	resolveHunk,
	toggleHunkAccepted,
} from "../lib/three-way-merge";
import type { ConflictZone } from "./ConflictHintBar";

// ── Inline accept bar rendered inside a Monaco view zone ────────────────────

function HunkAcceptBar({
	hunkId,
	theirsCount,
	oursCount,
	onAccept,
}: {
	hunkId: string;
	theirsCount: number;
	oursCount: number;
	onAccept: (id: string, res: "theirs" | "ours" | "both") => void;
}) {
	return (
		<div
			className="flex items-center gap-2 border-b border-[rgba(255,69,58,0.2)] px-3 py-1.5"
			style={{ background: "rgba(255, 69, 58, 0.06)" }}
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--color-danger)"
				strokeWidth="2"
				className="shrink-0"
			>
				<circle cx="12" cy="12" r="10" />
				<path d="M12 8v4" />
				<path d="M12 16h.01" />
			</svg>
			<span className="text-[11px] font-medium text-[var(--color-danger)]">Conflict</span>
			<span className="text-[11px] text-[var(--text-quaternary)]">—</span>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "theirs")}
				title="Accept Theirs (t)"
				className="rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110"
				style={{ color: "var(--accent)", background: "rgba(10, 132, 255, 0.15)" }}
			>
				← Accept Theirs ({theirsCount} line{theirsCount !== 1 ? "s" : ""})
			</button>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "ours")}
				title="Accept Yours (b)"
				className="rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110"
				style={{ color: "var(--color-purple)", background: "rgba(191, 90, 242, 0.15)" }}
			>
				Accept Yours ({oursCount} line{oursCount !== 1 ? "s" : ""}) →
			</button>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "both")}
				title="Accept Both (+)"
				className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)]"
			>
				Both
			</button>
		</div>
	);
}

// ── Auto-merged change indicator (clickable to toggle) ─────────────────────

function AutoMergedBar({
	hunkId,
	source,
	accepted,
	lineCount,
	onToggle,
}: {
	hunkId: string;
	source: string;
	accepted: boolean;
	lineCount: number;
	onToggle: (id: string) => void;
}) {
	const sourceLabel = source === "theirs" ? "theirs" : source === "ours" ? "yours" : "both sides";
	return (
		<div
			className="flex items-center gap-1.5 px-3 py-0.5"
			style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border-subtle)" }}
		>
			<button
				type="button"
				onClick={() => onToggle(hunkId)}
				className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-[var(--bg-elevated)]"
				style={{ color: accepted ? "var(--color-success)" : "var(--text-quaternary)" }}
			>
				{accepted ? "✓" : "○"} {lineCount} line{lineCount !== 1 ? "s" : ""} from {sourceLabel}
				<span className="text-[var(--text-quaternary)]">
					{accepted ? "(click to exclude)" : "(click to include)"}
				</span>
			</button>
		</div>
	);
}

// ── Conflict-type banner ─────────────────────────────────────────────────────

const CONFLICT_MESSAGES: Partial<Record<ConflictType, (src: string, tgt: string) => string>> = {
	"delete/add": (src) => `This file was added in ${src} and is absent in your branch.`,
	"add/delete": (_src, tgt) =>
		`This file was added in your branch (${tgt}) and is absent in theirs.`,
	"delete/modify": (_src, tgt) =>
		`You deleted this file (${tgt}), but it was modified in their branch. Accept theirs to keep their version, or accept yours to delete it.`,
	"modify/delete": (src) =>
		`You modified this file, but it was deleted in ${src}. Accept yours to keep your changes, or accept theirs to delete it.`,
	unknown: () => "The conflict type for this file could not be determined. Use Quick Accept below.",
};

function ConflictTypeBanner({
	conflictType,
	sourceBranch,
	targetBranch,
	onResolveTheirs,
	onResolveOurs,
}: {
	conflictType: ConflictType;
	sourceBranch: string;
	targetBranch: string;
	onResolveTheirs: () => void;
	onResolveOurs: () => void;
}) {
	const message = CONFLICT_MESSAGES[conflictType]?.(sourceBranch, targetBranch);
	if (!message) return null;

	return (
		<div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[rgba(255,159,10,0.06)] px-4 py-2">
			<svg
				width="13"
				height="13"
				viewBox="0 0 24 24"
				fill="none"
				stroke="var(--color-warning)"
				strokeWidth="2"
				className="shrink-0"
			>
				<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
				<path d="M12 9v4" />
				<path d="M12 17h.01" />
			</svg>
			<span className="flex-1 text-[12px] text-[var(--color-warning)]">{message}</span>
			{conflictType === "delete/add" && (
				<button
					type="button"
					onClick={onResolveTheirs}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110"
					style={{ color: "var(--accent)", background: "rgba(10, 132, 255, 0.15)" }}
				>
					← Accept Theirs
				</button>
			)}
			{conflictType === "add/delete" && (
				<button
					type="button"
					onClick={onResolveOurs}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110"
					style={{ color: "var(--color-purple)", background: "rgba(191, 90, 242, 0.15)" }}
				>
					Accept Yours →
				</button>
			)}
		</div>
	);
}

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
	filePath: string;
	content: { base: string; ours: string; theirs: string; conflictType: ConflictType };
	sourceBranch: string;
	targetBranch: string;
	onResolve: (resolvedContent: string) => void;
	zone: ConflictZone;
	onZoneChange: (zone: ConflictZone) => void;
}

// ── Main component ──────────────────────────────────────────────────────────

export function ThreeWayDiffEditor({
	filePath,
	content,
	sourceBranch,
	targetBranch,
	onResolve,
	zone,
	onZoneChange,
}: Props) {
	const [hunks, setHunks] = useState<MergeHunk[]>([]);
	const [mergedContent, setMergedContent] = useState("");
	const [focusedHunkIndex, setFocusedHunkIndex] = useState(0);

	// Refs for values accessed inside document keydown handlers (avoids stale closures)
	const hunksRef = useRef<MergeHunk[]>([]);
	const focusedHunkIndexRef = useRef(0);
	const previousHunksRef = useRef<MergeHunk[] | null>(null);
	const onResolveRef = useRef(onResolve);
	const onZoneChangeRef = useRef(onZoneChange);

	const theirsRef = useRef<HTMLDivElement>(null);
	const resultRef = useRef<HTMLDivElement>(null);
	const oursRef = useRef<HTMLDivElement>(null);

	const theirsEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const resultEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const oursEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const editModeKeyRef = useRef<monaco.editor.IContextKey<boolean> | null>(null);

	// Scroll sync guard
	const scrollSyncRef = useRef(false);

	// Decoration refs
	const theirsDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const oursDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const resultDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

	// View zone tracking
	const zoneMapRef = useRef<
		Map<
			string,
			{
				zoneId: string;
				root: ReturnType<typeof createRoot>;
				domNode: HTMLDivElement;
				afterLineNumber: number;
			}
		>
	>(new Map());

	const language = detectLanguage(filePath);

	// ── Compute three-way merge when content changes ────────────────────────

	useEffect(() => {
		resetHunkCounter();
		const result = computeThreeWayMerge(content.base, content.ours, content.theirs);
		setHunks(result.hunks);
		setMergedContent(result.mergedContent);
		// Clear undo history so switching files doesn't let ⌘Z reach previous file's edits
		previousHunksRef.current = null;
	}, [content]);

	useEffect(() => {
		hunksRef.current = hunks;
	}, [hunks]);
	useEffect(() => {
		focusedHunkIndexRef.current = focusedHunkIndex;
	}, [focusedHunkIndex]);
	useEffect(() => {
		onResolveRef.current = onResolve;
	}, [onResolve]);
	useEffect(() => {
		onZoneChangeRef.current = onZoneChange;
	}, [onZoneChange]);

	// Keep Monaco editModeActive context key in sync with zone prop
	useEffect(() => {
		editModeKeyRef.current?.set(zone === "edit");
		// When leaving edit mode, blur Monaco so document keydown handlers (nav/sidebar
		// shortcuts) aren't silently swallowed by Monaco's contenteditable textarea.
		if (zone !== "edit") {
			const active = document.activeElement as HTMLElement | null;
			if (
				active &&
				(resultRef.current?.contains(active) ||
					theirsRef.current?.contains(active) ||
					oursRef.current?.contains(active))
			) {
				active.blur();
			}
		}
	}, [zone]);

	// Reset focused hunk when file content changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: content change is the reset signal; setFocusedHunkIndex is a stable setter
	useEffect(() => {
		setFocusedHunkIndex(0);
	}, [content]);

	// Sync Monaco model language when filePath changes (no remount to handle this)
	useEffect(() => {
		for (const editorRef of [theirsEditorRef, resultEditorRef, oursEditorRef]) {
			const model = editorRef.current?.getModel();
			if (model) monaco.editor.setModelLanguage(model, language);
		}
	}, [language]);

	// ── Nav mode keyboard shortcuts ─────────────────────────────────────────

	useEffect(() => {
		if (zone !== "nav") return;

		function handleKeyDown(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (shouldSkipShortcutHandling(e, target) || target.isContentEditable) return;

			const currentHunks = hunksRef.current;
			const conflictHunks = currentHunks.filter((h) => h.type === "conflict");
			const index = focusedHunkIndexRef.current;
			const hunk = conflictHunks[index];

			if (e.key === "t" || e.key === "b" || e.key === "+") {
				if (!hunk || hunk.status !== "pending") return;
				e.preventDefault();
				const resolution = e.key === "t" ? "theirs" : e.key === "b" ? "ours" : "both";
				previousHunksRef.current = currentHunks;
				const { hunks: newHunks, mergedContent: newContent } = resolveHunk(
					currentHunks,
					hunk.id,
					resolution
				);
				setHunks(newHunks);
				setMergedContent(newContent);
				// Advance to next pending hunk
				const newConflictHunks = newHunks.filter((h) => h.type === "conflict");
				const nextPending = newConflictHunks.findIndex(
					(h, i) => i > index && h.status === "pending"
				);
				if (nextPending >= 0) setFocusedHunkIndex(nextPending);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setFocusedHunkIndex((i) => Math.max(0, i - 1));
			} else if (e.key === "ArrowDown") {
				e.preventDefault();
				setFocusedHunkIndex((i) => Math.min(Math.max(0, conflictHunks.length - 1), i + 1));
			} else if (e.key === "e") {
				e.preventDefault();
				onZoneChangeRef.current("edit");
				resultEditorRef.current?.focus();
			} else if ((e.metaKey || e.ctrlKey) && e.key === "z") {
				e.preventDefault();
				const prev = previousHunksRef.current;
				if (!prev) return;
				previousHunksRef.current = null;
				const lines = prev.flatMap((h) => h.resultLines);
				const restored = lines.length > 0 ? `${lines.join("\n")}\n` : "";
				setHunks(prev);
				setMergedContent(restored);
			}
		}

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [zone]);

	// ── Scroll to focused hunk ──────────────────────────────────────────────

	useEffect(() => {
		const conflictHunks = hunks.filter((h) => h.type === "conflict");
		const hunk = conflictHunks[focusedHunkIndex];
		if (hunk) {
			resultEditorRef.current?.revealLineInCenter(hunk.startLine);
		}
	}, [focusedHunkIndex, hunks]);

	// ── Create the three editors once on mount ──────────────────────────────

	// biome-ignore lint/correctness/useExhaustiveDependencies: editors created once on mount
	useEffect(() => {
		if (!theirsRef.current || !resultRef.current || !oursRef.current) return;

		const theme = ensureThemeRegistered();

		const commonOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
			theme,
			fontSize: 13,
			fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', monospace",
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			lineNumbers: "on",
			folding: false,
			wordWrap: "off",
			automaticLayout: true,
			scrollbar: { vertical: "visible", horizontal: "visible" },
			overviewRulerLanes: 0,
		};

		const theirsEditor = monaco.editor.create(theirsRef.current, {
			...commonOptions,
			readOnly: true,
			value: content.theirs,
			language,
		});

		const resultEditor = monaco.editor.create(resultRef.current, {
			...commonOptions,
			readOnly: false,
			value: mergedContent,
			language,
		});

		const oursEditor = monaco.editor.create(oursRef.current, {
			...commonOptions,
			readOnly: true,
			value: content.ours,
			language,
		});

		theirsEditorRef.current = theirsEditor;
		resultEditorRef.current = resultEditor;
		oursEditorRef.current = oursEditor;
		editModeKeyRef.current = resultEditor.createContextKey<boolean>("editModeActive", false);

		// Synchronized scrolling between all three panels
		function syncScrollFrom(
			source: monaco.editor.IStandaloneCodeEditor,
			targets: monaco.editor.IStandaloneCodeEditor[]
		) {
			return source.onDidScrollChange((e) => {
				if (scrollSyncRef.current) return;
				scrollSyncRef.current = true;
				for (const target of targets) {
					target.setScrollPosition({ scrollTop: e.scrollTop, scrollLeft: e.scrollLeft });
				}
				scrollSyncRef.current = false;
			});
		}

		const sub1 = syncScrollFrom(theirsEditor, [resultEditor, oursEditor]);
		const sub2 = syncScrollFrom(resultEditor, [theirsEditor, oursEditor]);
		const sub3 = syncScrollFrom(oursEditor, [theirsEditor, resultEditor]);

		// Edit Mode: clicking in the Result panel enters edit mode
		const focusSub = resultEditor.onDidFocusEditorText(() => {
			onZoneChangeRef.current("edit");
		});

		// ⌘↵ in Edit Mode = mark resolved with current content
		resultEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
			const model = resultEditor.getModel();
			if (model) onResolveRef.current(model.getValue());
		});

		// Esc in Edit Mode = exit back to nav mode (when condition prevents intercepting Monaco's built-in Esc handlers)
		resultEditor.addCommand(
			monaco.KeyCode.Escape,
			() => {
				onZoneChangeRef.current("nav");
				resultEditor.blur();
			},
			"editModeActive"
		);

		return () => {
			sub1.dispose();
			sub2.dispose();
			sub3.dispose();
			focusSub.dispose();
			theirsDecoRef.current?.clear();
			oursDecoRef.current?.clear();
			resultDecoRef.current?.clear();
			theirsEditor.dispose();
			resultEditor.dispose();
			oursEditor.dispose();
			theirsEditorRef.current = null;
			resultEditorRef.current = null;
			oursEditorRef.current = null;
		};
	}, []);

	// ── Update side panels when content changes ─────────────────────────────

	useEffect(() => {
		const theirs = theirsEditorRef.current;
		const ours = oursEditorRef.current;
		if (!theirs || !ours) return;

		const theirsModel = theirs.getModel();
		if (theirsModel && theirsModel.getValue() !== content.theirs) {
			theirsModel.setValue(content.theirs);
		}
		const oursModel = ours.getModel();
		if (oursModel && oursModel.getValue() !== content.ours) {
			oursModel.setValue(content.ours);
		}
	}, [content]);

	// ── Update result editor when mergedContent changes ─────────────────────

	useEffect(() => {
		const result = resultEditorRef.current;
		if (!result) return;
		const model = result.getModel();
		if (model && model.getValue() !== mergedContent) {
			model.setValue(mergedContent);
		}
	}, [mergedContent]);

	// ── Apply decorations to theirs (left) panel ────────────────────────────

	useEffect(() => {
		const editor = theirsEditorRef.current;
		if (!editor) return;

		theirsDecoRef.current?.clear();

		const regions = computeSideDiffs(content.base, content.theirs);
		const decorations: monaco.editor.IModelDeltaDecoration[] = regions.map((r) => ({
			range: new monaco.Range(r.startLine, 1, r.endLine, 1),
			options: {
				isWholeLine: true,
				className: r.type === "added" ? "merge-side-added" : "merge-side-modified",
				linesDecorationsClassName: "merge-gutter-theirs",
			},
		}));

		theirsDecoRef.current = editor.createDecorationsCollection(decorations);
	}, [content]);

	// ── Apply decorations to ours (right) panel ─────────────────────────────

	useEffect(() => {
		const editor = oursEditorRef.current;
		if (!editor) return;

		oursDecoRef.current?.clear();

		const regions = computeSideDiffs(content.base, content.ours);
		const decorations: monaco.editor.IModelDeltaDecoration[] = regions.map((r) => ({
			range: new monaco.Range(r.startLine, 1, r.endLine, 1),
			options: {
				isWholeLine: true,
				className: r.type === "added" ? "merge-side-added" : "merge-side-modified",
				linesDecorationsClassName: "merge-gutter-ours",
			},
		}));

		oursDecoRef.current = editor.createDecorationsCollection(decorations);
	}, [content]);

	// ── Apply decorations to result (center) panel ─────────────────────────

	useEffect(() => {
		const editor = resultEditorRef.current;
		if (!editor) return;

		resultDecoRef.current?.clear();

		const decorations: monaco.editor.IModelDeltaDecoration[] = [];

		for (const h of hunks) {
			const endLine = h.startLine + Math.max(h.resultLines.length - 1, 0);

			if (h.type === "conflict") {
				const isPending = h.status === "pending";
				decorations.push({
					range: new monaco.Range(h.startLine, 1, endLine, 1),
					options: {
						isWholeLine: true,
						className: isPending ? "merge-conflict-pending" : "merge-conflict-resolved",
						linesDecorationsClassName: isPending
							? "merge-conflict-gutter-pending"
							: "merge-conflict-gutter-resolved",
					},
				});
			} else if (h.type === "ok" && h.source) {
				// Auto-merged non-conflicting changes — show subtle decoration
				const gutterClass =
					h.source === "theirs"
						? "merge-auto-gutter-theirs"
						: h.source === "ours"
							? "merge-auto-gutter-ours"
							: "merge-auto-gutter-theirs";
				const bgClass =
					h.source === "theirs"
						? "merge-auto-theirs"
						: h.source === "ours"
							? "merge-auto-ours"
							: "merge-auto-theirs";
				decorations.push({
					range: new monaco.Range(h.startLine, 1, endLine, 1),
					options: {
						isWholeLine: true,
						className: bgClass,
						linesDecorationsClassName: gutterClass,
					},
				});
			}
		}

		resultDecoRef.current = editor.createDecorationsCollection(decorations);
	}, [hunks]);

	// ── Hunk accept handler (for conflicts) ────────────────────────────────

	const handleAccept = useCallback(
		(hunkId: string, resolution: "theirs" | "ours" | "both") => {
			const result = resolveHunk(hunks, hunkId, resolution);
			setHunks(result.hunks);
			setMergedContent(result.mergedContent);
		},
		[hunks]
	);

	// ── Toggle handler (for auto-merged non-conflict changes) ───────────────

	const handleToggle = useCallback(
		(hunkId: string) => {
			const result = toggleHunkAccepted(hunks, hunkId);
			setHunks(result.hunks);
			setMergedContent(result.mergedContent);
		},
		[hunks]
	);

	// ── View zones for conflict hunks + auto-merged change indicators ──────

	useEffect(() => {
		const editor = resultEditorRef.current;
		if (!editor) return;

		const zoneMap = zoneMapRef.current;

		const zonableHunks = hunks.filter(
			(h) => (h.type === "conflict" && h.status === "pending") || (h.type === "ok" && h.source)
		);
		const desiredIds = new Set(zonableHunks.map((h) => h.id));

		// Remove zones for hunks that are no longer zonable (e.g. resolved conflicts)
		const toRemove = [...zoneMap.keys()].filter((id) => !desiredIds.has(id));
		if (toRemove.length > 0) {
			editor.changeViewZones((acc) => {
				for (const id of toRemove) {
					const entry = zoneMap.get(id);
					if (entry) {
						acc.removeZone(entry.zoneId);
						queueMicrotask(() => entry.root.unmount());
						zoneMap.delete(id);
					}
				}
			});
		}

		// Add or update zones for current zonable hunks
		const toAdd: typeof zonableHunks = [];
		for (const hunk of zonableHunks) {
			const existing = zoneMap.get(hunk.id);
			if (existing && existing.afterLineNumber === hunk.startLine - 1) {
				// Position unchanged — re-render in place, React handles the diff
				const isConflict = hunk.type === "conflict";
				if (isConflict) {
					existing.root.render(
						<HunkAcceptBar
							hunkId={hunk.id}
							theirsCount={hunk.theirsLines.length}
							oursCount={hunk.oursLines.length}
							onAccept={handleAccept}
						/>
					);
				} else {
					existing.root.render(
						<AutoMergedBar
							hunkId={hunk.id}
							source={hunk.source ?? "both sides"}
							accepted={hunk.accepted}
							lineCount={hunk.resultLines.length}
							onToggle={handleToggle}
						/>
					);
				}
			} else {
				if (existing) {
					// Position shifted — remove old zone so it can be re-created at the new line
					editor.changeViewZones((acc) => {
						acc.removeZone(existing.zoneId);
					});
					queueMicrotask(() => existing.root.unmount());
					zoneMap.delete(hunk.id);
				}
				toAdd.push(hunk);
			}
		}

		if (toAdd.length > 0) {
			editor.changeViewZones((acc) => {
				for (const hunk of toAdd) {
					const domNode = document.createElement("div");
					domNode.style.pointerEvents = "auto";
					domNode.style.zIndex = "10";
					domNode.addEventListener("mousedown", (e) => e.stopPropagation());

					const isConflict = hunk.type === "conflict";
					const afterLineNumber = hunk.startLine - 1;
					const zoneId = acc.addZone({
						afterLineNumber,
						heightInLines: isConflict ? 2 : 1,
						domNode,
					});

					const root = createRoot(domNode);
					zoneMap.set(hunk.id, { zoneId, root, domNode, afterLineNumber });

					if (isConflict) {
						root.render(
							<HunkAcceptBar
								hunkId={hunk.id}
								theirsCount={hunk.theirsLines.length}
								oursCount={hunk.oursLines.length}
								onAccept={handleAccept}
							/>
						);
					} else {
						root.render(
							<AutoMergedBar
								hunkId={hunk.id}
								source={hunk.source ?? "both sides"}
								accepted={hunk.accepted}
								lineCount={hunk.resultLines.length}
								onToggle={handleToggle}
							/>
						);
					}
				}
			});
		}

		return () => {
			editor.changeViewZones((acc) => {
				for (const entry of zoneMap.values()) {
					acc.removeZone(entry.zoneId);
					queueMicrotask(() => entry.root.unmount());
				}
			});
			zoneMap.clear();
		};
	}, [hunks, handleAccept, handleToggle]);

	const conflictHunks = hunks.filter((h) => h.type === "conflict");
	const resolvedCount = conflictHunks.filter((h) => h.status === "resolved").length;
	const totalConflicts = conflictHunks.length;
	const allResolved = totalConflicts === 0 || resolvedCount === totalConflicts;
	const autoMergedCount = hunks.filter((h) => h.type === "ok" && h.source).length;

	// Auto-fire: when all hunks resolved in nav mode, stage the file automatically
	// biome-ignore lint/correctness/useExhaustiveDependencies: onResolveRef is a stable ref — no need to list it
	useEffect(() => {
		if (!allResolved || totalConflicts === 0 || zone !== "nav") return;
		const timer = setTimeout(() => {
			const editor = resultEditorRef.current;
			const model = editor?.getModel();
			if (model) onResolveRef.current(model.getValue());
		}, 150);
		return () => clearTimeout(timer);
	}, [allResolved, totalConflicts, zone]);

	// ── Quick accept-all helpers ────────────────────────────────────────────

	function acceptAll(resolution: "theirs" | "ours" | "both") {
		let current = hunks;
		for (const h of current) {
			if (h.type === "conflict" && h.status === "pending") {
				const result = resolveHunk(current, h.id, resolution);
				current = result.hunks;
			}
		}
		const lines = current.flatMap((h) => h.resultLines);
		const finalContent = lines.length > 0 ? `${lines.join("\n")}\n` : "";
		setHunks(current);
		setMergedContent(finalContent);
	}

	function handleMarkResolved() {
		const editor = resultEditorRef.current;
		if (!editor) return;
		const model = editor.getModel();
		if (!model) return;
		onResolve(model.getValue());
	}

	// ── Render ──────────────────────────────────────────────────────────────

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
			{/* Column headers */}
			<div className="flex h-9 shrink-0 items-stretch border-b border-[var(--border)]">
				{/* Theirs header */}
				<div className="flex flex-1 items-center gap-2 border-r border-[var(--border)] bg-[var(--bg-surface)] px-3">
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: "var(--accent)" }}
					/>
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Theirs ({sourceBranch})
					</span>
					<button
						type="button"
						onClick={() => acceptAll("theirs")}
						title="Accept All Theirs (⌥A)"
						className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					>
						Accept All
					</button>
				</div>

				{/* Result header */}
				<div
					className="flex flex-1 items-center gap-2 border-r px-3 transition-colors duration-150"
					style={{
						borderColor: "var(--border)",
						borderTop: zone === "edit" ? "2px solid rgba(255,215,0,0.4)" : "2px solid transparent",
						background: zone === "edit" ? "rgba(255,215,0,0.04)" : "var(--bg-surface)",
					}}
				>
					{zone === "edit" ? (
						<span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[rgba(255,215,0,0.8)]">
							<span className="h-1.5 w-1.5 rounded-full bg-[rgba(255,215,0,0.8)]" />
							EDITING
						</span>
					) : (
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{
								backgroundColor: allResolved ? "var(--color-success)" : "var(--color-warning)",
							}}
						/>
					)}
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Result
					</span>
					<button
						type="button"
						onClick={handleMarkResolved}
						disabled={totalConflicts > 0 && !allResolved}
						title={zone === "edit" ? "Mark Resolved (⌘↵)" : "Mark Resolved"}
						className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40"
						style={{ color: "var(--color-success)", background: "rgba(48,209,88,0.12)" }}
					>
						{zone === "edit" ? "Mark Resolved ⌘↵" : "Mark Resolved"}
					</button>
				</div>

				{/* Yours header */}
				<div className="flex flex-1 items-center gap-2 bg-[var(--bg-surface)] px-3">
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: "var(--color-purple)" }}
					/>
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Yours ({targetBranch})
					</span>
					<button
						type="button"
						onClick={() => acceptAll("ours")}
						title="Accept All Yours (⌥A)"
						className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					>
						Accept All
					</button>
				</div>
			</div>

			{/* Special conflict type explanation */}
			<ConflictTypeBanner
				conflictType={content.conflictType}
				sourceBranch={sourceBranch}
				targetBranch={targetBranch}
				onResolveTheirs={() => onResolve(content.theirs)}
				onResolveOurs={() => onResolve(content.ours)}
			/>

			{/* Three editor panels */}
			<div className="flex min-h-0 flex-1">
				<div ref={theirsRef} className="min-w-0 flex-1 border-r border-[var(--border)]" />
				<div ref={resultRef} className="min-w-0 flex-1 border-r border-[var(--border)]" />
				<div ref={oursRef} className="min-w-0 flex-1" />
			</div>

			{/* Status bar */}
			<div className="flex h-8 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{filePath}
				</span>

				{totalConflicts > 0 && (
					<span
						className="shrink-0 text-[11px] font-medium"
						style={{ color: allResolved ? "var(--color-success)" : "var(--color-danger)" }}
					>
						{resolvedCount}/{totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""} resolved
					</span>
				)}
				{autoMergedCount > 0 && (
					<span className="shrink-0 text-[11px] text-[var(--text-quaternary)]">
						{autoMergedCount} auto-merged
					</span>
				)}

				<span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">Quick accept:</span>
				<button
					type="button"
					onClick={() => acceptAll("theirs")}
					title="Accept All Theirs"
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "var(--accent)" }}
				>
					Theirs
				</button>
				<button
					type="button"
					onClick={() => acceptAll("ours")}
					title="Accept All Yours"
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "var(--color-purple)" }}
				>
					Yours
				</button>
				<button
					type="button"
					onClick={() => acceptAll("both")}
					title="Accept All Both"
					className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					Both
				</button>
			</div>
		</div>
	);
}
