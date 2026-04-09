import { useTabStore } from "../stores/tab-store";

interface MarkdownPreviewButtonProps {
	language: string;
}

export function MarkdownPreviewButton({ language }: MarkdownPreviewButtonProps) {
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
					markdownPreviewMode === "rendered" ? "bg-[var(--accent)] text-white" : inactiveStyle,
				].join(" ")}
			>
				Rendered
			</button>
		</>
	);
}
