import { useTabStore } from "../stores/tab-store";

interface MarkdownPreviewButtonProps {
	language: string;
}

type PreviewMode = "off" | "split" | "rendered";

const NEXT_MODE: Record<PreviewMode, PreviewMode> = {
	off: "split",
	split: "rendered",
	rendered: "off",
};

export function MarkdownPreviewButton({ language }: MarkdownPreviewButtonProps) {
	const markdownPreviewMode = useTabStore((s) => s.markdownPreviewMode);
	const setMarkdownPreviewMode = useTabStore((s) => s.setMarkdownPreviewMode);

	if (language !== "markdown") return null;

	return (
		<button
			type="button"
			onClick={() => setMarkdownPreviewMode(NEXT_MODE[markdownPreviewMode])}
			className={[
				"rounded px-2 py-0.5 text-[11px] transition-colors",
				markdownPreviewMode === "off"
					? "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"
					: markdownPreviewMode === "split"
						? "border border-[var(--accent)] text-[var(--accent)]"
						: "bg-[var(--accent)] text-white",
			].join(" ")}
		>
			{markdownPreviewMode === "off"
				? "Preview"
				: markdownPreviewMode === "split"
					? "Split"
					: "Rendered"}
		</button>
	);
}
