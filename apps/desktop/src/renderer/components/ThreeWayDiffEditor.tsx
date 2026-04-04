import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { detectLanguage } from "../../shared/diff-types";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";
import {
	type MergeHunk,
	computeSideDiffs,
	computeThreeWayMerge,
	resolveHunk,
} from "../lib/three-way-merge";

// ── Inline accept bar rendered inside a Monaco view zone ────────────────────

function HunkAcceptBar({
	hunkId,
	onAccept,
}: {
	hunkId: string;
	onAccept: (id: string, res: "theirs" | "ours" | "both") => void;
}) {
	return (
		<div
			className="flex items-center gap-1.5 px-3 py-1"
			style={{ background: "var(--bg-surface)" }}
		>
			<span className="text-[11px] text-[var(--text-quaternary)]">Conflict:</span>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "theirs")}
				className="rounded px-2 py-0.5 text-[11px] font-medium"
				style={{ color: "#0a84ff", background: "rgba(10, 132, 255, 0.12)" }}
			>
				Accept Theirs
			</button>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "ours")}
				className="rounded px-2 py-0.5 text-[11px] font-medium"
				style={{ color: "#bf5af2", background: "rgba(191, 90, 242, 0.12)" }}
			>
				Accept Yours
			</button>
			<button
				type="button"
				onClick={() => onAccept(hunkId, "both")}
				className="rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
			>
				Accept Both
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
	// State: merge hunks and merged text
	const [hunks, setHunks] = useState<MergeHunk[]>([]);
	const [mergedContent, setMergedContent] = useState("");

	// Refs for three editor containers
	const theirsRef = useRef<HTMLDivElement>(null);
	const resultRef = useRef<HTMLDivElement>(null);
	const oursRef = useRef<HTMLDivElement>(null);

	// Refs for editor instances
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
	const zoneIdsRef = useRef<string[]>([]);
	const rootsRef = useRef<ReturnType<typeof createRoot>[]>([]);

	const language = detectLanguage(filePath);

	// ── Compute three-way merge when content changes ────────────────────────

	useEffect(() => {
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

	// ── Apply conflict decorations to result (center) panel ─────────────────

	useEffect(() => {
		const editor = resultEditorRef.current;
		if (!editor) return;

		resultDecoRef.current?.clear();

		const decorations: monaco.editor.IModelDeltaDecoration[] = hunks
			.filter((h) => h.type === "conflict")
			.map((h) => {
				const endLine = h.startLine + Math.max(h.resultLines.length - 1, 0);
				const isPending = h.status === "pending";
				return {
					range: new monaco.Range(h.startLine, 1, endLine, 1),
					options: {
						isWholeLine: true,
						className: isPending ? "merge-conflict-pending" : "merge-conflict-resolved",
						linesDecorationsClassName: isPending
							? "merge-conflict-gutter-pending"
							: "merge-conflict-gutter-resolved",
					},
				};
			});

		resultDecoRef.current = editor.createDecorationsCollection(decorations);
	}, [hunks]);

	// ── Hunk accept handler ─────────────────────────────────────────────────

	const handleAccept = useCallback(
		(hunkId: string, resolution: "theirs" | "ours" | "both") => {
			const result = resolveHunk(hunks, hunkId, resolution);
			setHunks(result.hunks);
			setMergedContent(result.mergedContent);
		},
		[hunks]
	);

	// ── View zones for pending conflict hunks ───────────────────────────────

	useEffect(() => {
		const editor = resultEditorRef.current;
		if (!editor) return;

		// Clean up previous zones
		editor.changeViewZones((acc) => {
			for (const id of zoneIdsRef.current) acc.removeZone(id);
		});
		const staleRoots = rootsRef.current;
		queueMicrotask(() => {
			for (const root of staleRoots) root.unmount();
		});
		zoneIdsRef.current = [];
		rootsRef.current = [];

		const pendingConflicts = hunks.filter((h) => h.type === "conflict" && h.status === "pending");
		if (pendingConflicts.length === 0) return;

		const newZoneIds: string[] = [];
		const newRoots: ReturnType<typeof createRoot>[] = [];

		editor.changeViewZones((acc) => {
			for (const hunk of pendingConflicts) {
				const domNode = document.createElement("div");
				domNode.style.pointerEvents = "auto";
				domNode.style.zIndex = "10";
				domNode.addEventListener("mousedown", (e) => e.stopPropagation());

				const zoneId = acc.addZone({
					afterLineNumber: hunk.startLine - 1,
					heightInLines: 2,
					domNode,
				});
				newZoneIds.push(zoneId);

				const root = createRoot(domNode);
				newRoots.push(root);
				root.render(<HunkAcceptBar hunkId={hunk.id} onAccept={handleAccept} />);
			}
		});

		zoneIdsRef.current = newZoneIds;
		rootsRef.current = newRoots;

		return () => {
			editor.changeViewZones((acc) => {
				for (const id of newZoneIds) acc.removeZone(id);
			});
			queueMicrotask(() => {
				for (const root of newRoots) root.unmount();
			});
		};
	}, [hunks, handleAccept]);

	// ── Derived state ───────────────────────────────────────────────────────

	const conflictHunks = hunks.filter((h) => h.type === "conflict");
	const resolvedCount = conflictHunks.filter((h) => h.status === "resolved").length;
	const totalConflicts = conflictHunks.length;
	const allResolved = totalConflicts > 0 && resolvedCount === totalConflicts;

	// ── Quick accept-all helpers ────────────────────────────────────────────

	function acceptAllSide(side: "theirs" | "ours") {
		let current = hunks;
		for (const h of current) {
			if (h.type === "conflict" && h.status === "pending") {
				const result = resolveHunk(current, h.id, side);
				current = result.hunks;
			}
		}
		// Recompute from the final state
		const finalResult = resolveHunk(current, "__noop__", "ours");
		// resolveHunk with unknown id returns hunks unchanged, so just use current
		const lines = current.flatMap((h) => h.resultLines);
		const finalContent = lines.length > 0 ? `${lines.join("\n")}\n` : "";
		setHunks(current);
		setMergedContent(finalContent);
	}

	function acceptAllBoth() {
		let current = hunks;
		for (const h of current) {
			if (h.type === "conflict" && h.status === "pending") {
				const result = resolveHunk(current, h.id, "both");
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
					<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "#0a84ff" }} />
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Theirs ({sourceBranch})
					</span>
					<button
						type="button"
						onClick={() => acceptAllSide("theirs")}
						className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					>
						Accept All
					</button>
				</div>

				{/* Result header */}
				<div className="flex flex-1 items-center gap-2 border-r border-[var(--border)] bg-[var(--bg-surface)] px-3">
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: allResolved ? "#30d158" : "#ff9f0a" }}
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
							color: "#30d158",
							background: "rgba(48, 209, 88, 0.12)",
						}}
					>
						Mark Resolved
					</button>
				</div>

				{/* Yours header */}
				<div className="flex flex-1 items-center gap-2 bg-[var(--bg-surface)] px-3">
					<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "#bf5af2" }} />
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Yours ({targetBranch})
					</span>
					<button
						type="button"
						onClick={() => acceptAllSide("ours")}
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
						style={{ color: allResolved ? "#30d158" : "#ff9f0a" }}
					>
						{resolvedCount} of {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""} resolved
					</span>
				)}

				<span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">Quick accept:</span>
				<button
					type="button"
					onClick={() => acceptAllSide("theirs")}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "#0a84ff" }}
				>
					Theirs
				</button>
				<button
					type="button"
					onClick={() => acceptAllSide("ours")}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "#bf5af2" }}
				>
					Yours
				</button>
				<button
					type="button"
					onClick={acceptAllBoth}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					Both
				</button>
			</div>
		</div>
	);
}
