import { useTabStore } from "../stores/tab-store";

interface MarkdownPreviewButtonProps {
	language: string;
	/** Show the "Diff" button — only relevant in diff contexts (DiffFileTab, PRReviewFileTab) */
	showRichDiff?: boolean;
}

export function MarkdownPreviewButton({ language, showRichDiff }: MarkdownPreviewButtonProps) {
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const setMarkdownPreviewMode = useTabStore((s) => s.setMarkdownPreviewMode);

	if (language !== "markdown") return null;

	const inactiveStyle =
		"text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]";

	return (
		<>
			<button
				type="button"
				onClick={() => setMarkdownPreviewMode(markdownPreviewMode === "split" ? "off" : "split")}
				className={[
					"rounded px-2 py-0.5 text-[11px] transition-colors",
					markdownPreviewMode === "split"
						? "border border-[var(--accent)] text-[var(--accent)]"
						: inactiveStyle,
				].join(" ")}
			>
				Split
			</button>
			<button
				type="button"
				onClick={() =>
					setMarkdownPreviewMode(markdownPreviewMode === "rendered" ? "off" : "rendered")
				}
				className={[
					"rounded px-2 py-0.5 text-[11px] transition-colors",
					markdownPreviewMode === "rendered"
						? "bg-[var(--accent)] text-[var(--accent-foreground)]"
						: inactiveStyle,
				].join(" ")}
			>
				Rendered
			</button>
			{showRichDiff && (
				<button
					type="button"
					onClick={() =>
						setMarkdownPreviewMode(markdownPreviewMode === "rich-diff" ? "off" : "rich-diff")
					}
					className={[
						"rounded px-2 py-0.5 text-[11px] transition-colors",
						markdownPreviewMode === "rich-diff" ? "bg-[#30d158] text-[#1e1e2e]" : inactiveStyle,
					].join(" ")}
				>
					Diff
				</button>
			)}
		</>
	);
}
