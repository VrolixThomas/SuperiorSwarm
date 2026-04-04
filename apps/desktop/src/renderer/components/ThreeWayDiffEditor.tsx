import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { detectLanguage } from "../../shared/diff-types";
import { EDITOR_THEME, ensureThemeRegistered } from "../lib/monacoTheme";

interface Props {
	filePath: string;
	content: { base: string; ours: string; theirs: string };
	sourceBranch: string;
	targetBranch: string;
	onResolve: (resolvedContent: string) => void;
}

export function ThreeWayDiffEditor({
	filePath,
	content,
	sourceBranch,
	targetBranch,
	onResolve,
}: Props) {
	const theirsRef = useRef<HTMLDivElement>(null);
	const resultRef = useRef<HTMLDivElement>(null);
	const oursRef = useRef<HTMLDivElement>(null);

	const theirsEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const resultEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const oursEditorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

	// Track scroll sync to prevent feedback loops
	const scrollSyncRef = useRef(false);

	const language = detectLanguage(filePath);

	// Create the three editors once on mount
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
			value: content.ours,
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

		// Synchronized scrolling
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
			theirsEditor.dispose();
			resultEditor.dispose();
			oursEditor.dispose();
			theirsEditorRef.current = null;
			resultEditorRef.current = null;
			oursEditorRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
		// biome-ignore lint/correctness/useExhaustiveDependencies: editors created once on mount
	}, []);

	// Update editor content when props change without recreating editors
	useEffect(() => {
		const theirs = theirsEditorRef.current;
		const result = resultEditorRef.current;
		const ours = oursEditorRef.current;
		if (!theirs || !result || !ours) return;

		const theirsModel = theirs.getModel();
		if (theirsModel && theirsModel.getValue() !== content.theirs) {
			theirsModel.setValue(content.theirs);
		}
		const resultModel = result.getModel();
		if (resultModel && resultModel.getValue() !== content.ours) {
			resultModel.setValue(content.ours);
		}
		const oursModel = ours.getModel();
		if (oursModel && oursModel.getValue() !== content.ours) {
			oursModel.setValue(content.ours);
		}
	}, [content]);

	function acceptAll(side: "theirs" | "ours") {
		const resultEditor = resultEditorRef.current;
		if (!resultEditor) return;
		const model = resultEditor.getModel();
		if (!model) return;
		model.setValue(side === "theirs" ? content.theirs : content.ours);
	}

	function acceptBoth() {
		const resultEditor = resultEditorRef.current;
		if (!resultEditor) return;
		const model = resultEditor.getModel();
		if (!model) return;
		model.setValue(`${content.theirs}\n${content.ours}`);
	}

	function handleMarkResolved() {
		const resultEditor = resultEditorRef.current;
		if (!resultEditor) return;
		const model = resultEditor.getModel();
		if (!model) return;
		onResolve(model.getValue());
	}

	return (
		<div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
			{/* Column headers */}
			<div className="flex h-9 shrink-0 items-stretch border-b border-[var(--border)]">
				{/* Theirs header */}
				<div className="flex flex-1 items-center gap-2 border-r border-[var(--border)] bg-[var(--bg-surface)] px-3">
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: "#0a84ff" }}
					/>
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
						style={{ backgroundColor: "#30d158" }}
					/>
					<span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-secondary)]">
						Result
					</span>
					<button
						type="button"
						onClick={handleMarkResolved}
						className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium transition-colors"
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
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: "#bf5af2" }}
					/>
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

			{/* Bottom bar */}
			<div className="flex h-8 shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-surface)] px-3">
				<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-quaternary)]">
					{filePath}
				</span>
				<span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">Quick accept:</span>
				<button
					type="button"
					onClick={() => acceptAll("theirs")}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "#0a84ff" }}
				>
					Theirs
				</button>
				<button
					type="button"
					onClick={() => acceptAll("ours")}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] transition-colors hover:bg-[var(--bg-elevated)]"
					style={{ color: "#bf5af2" }}
				>
					Yours
				</button>
				<button
					type="button"
					onClick={acceptBoth}
					className="shrink-0 rounded px-2 py-0.5 text-[11px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
				>
					Both
				</button>
			</div>
		</div>
	);
}
