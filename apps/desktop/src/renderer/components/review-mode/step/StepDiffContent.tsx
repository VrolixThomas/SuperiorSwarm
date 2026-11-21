import type * as monaco from "monaco-editor";
import type { RefObject } from "react";
import { DiffEditor } from "../../DiffEditor";
import { MarkdownRenderedDiff } from "../../MarkdownRenderedDiff";
import { MarkdownRenderer } from "../../MarkdownRenderer";
interface Props {
	filePath: string | null;
	original: string;
	modified: string;
	language: string;
	diffMode: "split" | "inline";
	mode: "off" | "split" | "rendered" | "rich-diff";
	loading: boolean;
	unavailable: boolean;
	binary: boolean;
	onEditorReady: (editor: monaco.editor.IStandaloneDiffEditor | null) => void;
	paneRef: RefObject<HTMLDivElement | null>;
	onPaneScroll: () => void;
}
export function StepDiffContent({
	filePath,
	original,
	modified,
	language,
	diffMode,
	mode,
	loading,
	unavailable,
	binary,
	onEditorReady,
	paneRef,
	onPaneScroll,
}: Props) {
	const message =
		filePath === null
			? "No files changed"
			: loading
				? "Loading file…"
				: unavailable
					? "File content is unavailable at this revision."
					: binary
						? "Binary file — no text preview available."
						: !original && !modified
							? "File is empty or unavailable at this revision."
							: null;
	const previewOnly = mode === "rendered" || mode === "rich-diff";
	return (
		<div className="relative min-h-0 flex-1 overflow-hidden">
			<div
				aria-hidden={!!message || previewOnly}
				className={`flex h-full overflow-hidden ${message || previewOnly ? "invisible" : ""}`}
			>
				<div className="min-w-0 flex-1 overflow-hidden">
					<DiffEditor
						modelKey={filePath ?? ""}
						hideUnchangedRegions
						original={message ? "" : original}
						modified={message ? "" : modified}
						language={language}
						renderSideBySide={diffMode === "split"}
						readOnly
						onEditorReady={onEditorReady}
					/>
				</div>
				{mode === "split" && !message && (
					<div
						ref={paneRef}
						className="min-w-0 flex-1 overflow-y-auto border-l border-[var(--border)] p-4"
						onScroll={onPaneScroll}
					>
						<MarkdownRenderer content={modified} />
					</div>
				)}
			</div>
			{message ? (
				<output className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--text-tertiary)]">
					{message}
				</output>
			) : previewOnly ? (
				<div className="absolute inset-0 overflow-y-auto p-4">
					{mode === "rich-diff" ? (
						<MarkdownRenderedDiff original={original} modified={modified} />
					) : (
						<MarkdownRenderer content={modified} />
					)}
				</div>
			) : null}
		</div>
	);
}
