import { useEffect, useRef, useState } from "react";

interface ReplyComposerProps {
	placeholder: string;
	initialValue?: string;
	onDraftChange?: (body: string) => void;
	autoFocus?: boolean;
	ariaLabel?: string;
	submitLabel?: string;
	onSubmit: (body: string) => void | Promise<void>;
	onCancel: () => void;
}

export function ReplyComposer({
	placeholder,
	initialValue = "",
	autoFocus = false,
	ariaLabel,
	submitLabel = "Submit",
	onSubmit,
	onDraftChange,
	onCancel,
}: ReplyComposerProps) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [body, setBody] = useState(initialValue);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const initialValueRef = useRef(initialValue);
	const dirtyRef = useRef(false);
	const rows = Math.min(Math.max(body.split("\n").length, 2), 8);
	const trimmedBody = body.trim();

	const submit = async () => {
		if (busy || !trimmedBody) return;
		setBusy(true);
		setError(null);
		try {
			await onSubmit(trimmedBody);
		} catch (error) {
			setError(error instanceof Error ? error.message : "Submission failed; draft retained.");
		} finally {
			setBusy(false);
		}
	};
	useEffect(() => {
		if (initialValueRef.current === initialValue) return;
		initialValueRef.current = initialValue;
		if (!dirtyRef.current) setBody(initialValue);
	}, [initialValue]);

	useEffect(() => {
		if (!autoFocus) return;

		textareaRef.current?.focus();
		textareaRef.current?.select();
	}, [autoFocus]);

	return (
		<div onMouseDown={(event) => event.stopPropagation()}>
			<textarea
				disabled={busy}
				ref={textareaRef}
				value={body}
				onChange={(event) => {
					dirtyRef.current = true;
					setBody(event.target.value);
					onDraftChange?.(event.target.value);
				}}
				placeholder={placeholder}
				aria-label={ariaLabel ?? placeholder}
				rows={rows}
				onKeyDown={(event) => {
					event.stopPropagation();
					if (event.nativeEvent.isComposing) return;

					if (event.key === "Enter" && !event.shiftKey) {
						event.preventDefault();
						void submit();
						return;
					}

					if (event.key === "Escape") {
						event.preventDefault();
						onCancel();
					}
				}}
				className="w-full resize-none rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] outline-none transition-colors duration-[120ms] focus:border-[var(--accent)]"
			/>
			{error && <div role="alert">{error}</div>}
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
					disabled={!trimmedBody || busy}
					onClick={() => {
						void submit();
					}}
					className="rounded-[var(--radius-sm)] bg-[var(--accent)] px-2 py-1 text-[12px] font-medium text-[var(--accent-foreground)] transition-opacity duration-[120ms] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
				>
					{submitLabel}
				</button>
			</div>
		</div>
	);
}
