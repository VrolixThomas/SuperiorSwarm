import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { detectLanguage } from "../../shared/diff-types";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import {
	type MergeHunk,
	computeSideDiffs,
	computeThreeWayMerge,
	resetHunkCounter,
	resolveHunk,
	toggleHunkAccepted,
} from "../lib/three-way-merge";

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
				className="rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110"
				style={{ color: "var(--accent)", background: "rgba(10, 132, 255, 0.15)" }}
			>
				← Accept Theirs ({theirsCount} line{theirsCount !== 1 ? "s" : ""})
			</button>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "ours")}
				className="rounded px-2 py-0.5 text-[11px] font-medium transition-colors hover:brightness-110"
				style={{ color: "var(--color-purple)", background: "rgba(191, 90, 242, 0.15)" }}
			>
				Accept Yours ({oursCount} line{oursCount !== 1 ? "s" : ""}) →
			</button>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "both")}
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

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
	filePath: string;
	content: { base: string; ours: string; theirs: string };
	sourceBranch: string;
	targetBranch: string;
	onResolve: (resolvedContent: string) => void;
}

// ── Main component ──────────────────────────────────────────────────────────

export function ThreeWayDiffEditor({
	filePath,
	content,
	sourceBranch,
	targetBranch,
	onResolve,
}: Props) {
	const [hunks, setHunks] = useState<MergeHunk[]>([]);
	const [mergedContent, setMergedContent] = useState("");

	const theirsRef = useRef<HTMLDivElement>(null);
	const resultRef = useRef<HTMLDivElement>(null);
	const oursRef = useRef<HTMLDivElement>(null);

	const theirsEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const resultEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const oursEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

	// Scroll sync guard
	const scrollSyncRef = useRef(false);

	// Decoration refs
	const theirsDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const oursDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
	const resultDecoRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

	// View zone tracking
	const zoneMapRef = useRef<
		Map<string, { zoneId: string; root: ReturnType<typeof createRoot>; domNode: HTMLDivElement }>
	>(new Map());

	const language = detectLanguage(filePath);

	// ── Compute three-way merge when content changes ────────────────────────

	useEffect(() => {
		resetHunkCounter();
		const result = computeThreeWayMerge(content.base, content.ours, content.theirs);
		setHunks(result.hunks);
		setMergedContent(result.mergedContent);
	}, [content]);

	// ── Create the three editors once on mount ──────────────────────────────

	// biome-ignore lint/correctness/useExhaustiveDependencies: editors created once on mount
	useEffect(() => {
		if (!theirsRef.current || !resultRef.current || !oursRef.current) return;

		ensureThemeRegistered();

		const commonOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
			theme: EDITOR_THEME,
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

		return () => {
			sub1.dispose();
			sub2.dispose();
			sub3.dispose();
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
			(h) =>
				(h.type === "conflict" && h.status === "pending") ||
				(h.type === "ok" && h.source),
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
			if (existing) {
				// Re-render in place — React handles the diff
				const isConflict = hunk.type === "conflict";
				if (isConflict) {
					existing.root.render(
						<HunkAcceptBar
							hunkId={hunk.id}
							theirsCount={hunk.theirsLines.length}
							oursCount={hunk.oursLines.length}
							onAccept={handleAccept}
						/>,
					);
				} else {
					existing.root.render(
						<AutoMergedBar
							hunkId={hunk.id}
							source={hunk.source ?? "both sides"}
							accepted={hunk.accepted}
							lineCount={hunk.resultLines.length}
							onToggle={handleToggle}
						/>,
					);
				}
			} else {
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
					const zoneId = acc.addZone({
						afterLineNumber: hunk.startLine - 1,
						heightInLines: isConflict ? 2 : 1,
						domNode,
					});

					const root = createRoot(domNode);
					zoneMap.set(hunk.id, { zoneId, root, domNode });

					if (isConflict) {
						root.render(
							<HunkAcceptBar
								hunkId={hunk.id}
								theirsCount={hunk.theirsLines.length}
								oursCount={hunk.oursLines.length}
								onAccept={handleAccept}
							/>,
						);
					} else {
						root.render(
							<AutoMergedBar
								hunkId={hunk.id}
								source={hunk.source ?? "both sides"}
								accepted={hunk.accepted}
								lineCount={hunk.resultLines.length}
								onToggle={handleToggle}
							/>,
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
					<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Theirs ({sourceBranch})
					</span>
					<button
						type="button"
						onClick={() => acceptAll("theirs")}
						className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					>
						Accept All
					</button>
				</div>

				{/* Result header */}
				<div className="flex flex-1 items-center gap-2 border-r border-[var(--border)] bg-[var(--bg-surface)] px-3">
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: allResolved ? "var(--color-success)" : "var(--color-warning)" }}
					/>
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Result
					</span>
					<button
						type="button"
						onClick={handleMarkResolved}
						disabled={totalConflicts > 0 && !allResolved}
						className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40"
						style={{
							color: "var(--color-success)",
							background: "rgba(48, 209, 88, 0.12)",
						}}
					>
						Mark Resolved
					</button>
				</div>

				{/* Yours header */}
				<div className="flex flex-1 items-center gap-2 bg-[var(--bg-surface)] px-3">
					<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--color-purple)" }} />
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Yours ({targetBranch})
					</span>
					<button
						type="button"
						onClick={() => acceptAll("ours")}
						className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					>
						Accept All
					</button>
				</div>
			</div>

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
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "var(--accent)" }}
				>
					Theirs
				</button>
				<button
					type="button"
					onClick={() => acceptAll("ours")}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "var(--color-purple)" }}
				>
					Yours
				</button>
				<button
					type="button"
					onClick={() => acceptAll("both")}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					Both
				</button>
			</div>
		</div>
	);
}
