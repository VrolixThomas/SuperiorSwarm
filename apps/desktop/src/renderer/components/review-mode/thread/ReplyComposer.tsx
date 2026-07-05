import { useEffect, useRef, useState } from "react";

interface ReplyComposerProps {
	placeholder: string;
	initialValue?: string;
	autoFocus?: boolean;
	ariaLabel?: string;
	submitLabel?: string;
	onSubmit: (body: string) => void;
	onCancel: () => void;
}

export function ReplyComposer({
	placeholder,
	initialValue = "",
	autoFocus = false,
	ariaLabel,
	submitLabel = "Submit",
	onSubmit,
	onCancel,
}: ReplyComposerProps) {
	const [body, setBody] = useState(initialValue);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const rows = Math.min(Math.max(body.split("\n").length, 2), 8);
	const trimmedBody = body.trim();

	useEffect(() => {
		setBody(initialValue);
	}, [initialValue]);

	useEffect(() => {
		if (!autoFocus) return;

		textareaRef.current?.focus();
		textareaRef.current?.select();
	}, [autoFocus]);

	return (
		<div onMouseDown={(event) => event.stopPropagation()}>
			<textarea
				ref={textareaRef}
				value={body}
				onChange={(event) => setBody(event.target.value)}
				placeholder={placeholder}
				aria-label={ariaLabel ?? placeholder}
				rows={rows}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.nativeEvent.isComposing) return;

					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						if (trimmedBody) onSubmit(trimmedBody);
						return;
					}

					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
				className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] outline-none transition-colors duration-[120ms] focus:border-[var(--accent)]"
			/>
			<div className="mt-1 flex items-center gap-2">
				<div className="min-w-0 flex-1 text-[11px] text-[var(--text-quaternary)]">
					Enter to send &middot; Shift+Enter for new line &middot; Esc to cancel
				</div>
				<button
					type="button"
					onClick={onCancel}
					className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] font-medium text-[var(--text-tertiary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={!trimmedBody}
					onClick={() => {
						if (trimmedBody) onSubmit(trimmedBody);
					}}
					className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-1 text-[12px] font-medium text-[var(--accent-foreground)] transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{submitLabel}
				</button>
			</div>
		</div>
	);
}
