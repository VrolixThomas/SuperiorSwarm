import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { effectiveBody as resolveBody } from "../../../shared/prompt-preview";

type EditorMode = "edit" | "preview" | "full";
type FullPromptView = "plain" | "rendered";

export interface FullPromptVariant {
	key: string;
	label: string;
	render: (body: string) => string;
}

export interface PromptEditorProps {
	/** Persisted value (`null` = use default). */
	value: string | null | undefined;
	/** Called whenever the user edits the body. Pass `null` to revert to default. */
	onChange: (next: string | null) => void;
	/** The default body shown when the user hasn't customized. Used as placeholder + reset target. */
	defaultPrompt: string;
	/**
	 * One or more variants of the full assembled prompt (initial / follow-up / etc).
	 * Each variant gets a tab inside the Full Prompt view. Single variant = no sub-toggle.
	 */
	fullPromptVariants: FullPromptVariant[];
	/** Title for the editor card (e.g. "Review Instructions"). */
	title: string;
	/** Subtitle / description text. */
	subtitle: string;
}

const TAB_LABEL: Record<EditorMode, string> = {
	edit: "Edit",
	preview: "Preview",
	full: "Full Prompt",
};

const DEBOUNCE_MS = 500;

export function PromptEditor({
	value,
	onChange,
	defaultPrompt,
	fullPromptVariants,
	title,
	subtitle,
}: PromptEditorProps) {
	const [localValue, setLocalValue] = useState(value ?? "");
	const [mode, setMode] = useState<EditorMode>("edit");
	const [fullView, setFullView] = useState<FullPromptView>("plain");
	const [variantKey, setVariantKey] = useState(fullPromptVariants[0]?.key ?? "");
	const [copied, setCopied] = useState(false);

	// Stable ref to onChange so the debounce effect doesn't restart when the
	// parent re-renders (e.g. tRPC mutation hooks return a new function each render).
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	// Track the last server value we observed so we only seed local state when
	// the server actually changes, not when we echo our own mutation back.
	const lastServerValue = useRef(value ?? "");
	const dirty = useRef(false);

	useEffect(() => {
		const incoming = value ?? "";
		if (incoming === lastServerValue.current) return;
		lastServerValue.current = incoming;
		// Don't clobber an in-flight edit. The debounced commit will overwrite
		// the server soon enough, and the next tick's value will match.
		if (!dirty.current) setLocalValue(incoming);
	}, [value]);

	useEffect(() => {
		if (!dirty.current) return;
		const timer = setTimeout(() => {
			dirty.current = false;
			lastServerValue.current = localValue;
			onChangeRef.current(localValue || null);
		}, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [localValue]);

	const handleEdit = useCallback((next: string) => {
		dirty.current = true;
		setLocalValue(next);
	}, []);

	const handleReset = useCallback(() => {
		dirty.current = false;
		lastServerValue.current = "";
		setLocalValue("");
		onChangeRef.current(null);
	}, []);

	const activeVariant =
		fullPromptVariants.find((v) => v.key === variantKey) ?? fullPromptVariants[0];

	const effectiveBody = useMemo(
		() => (mode === "edit" ? "" : resolveBody(localValue, defaultPrompt)),
		[mode, localValue, defaultPrompt]
	);

	const fullPrompt = useMemo(
		() => (mode === "full" && activeVariant ? activeVariant.render(effectiveBody) : ""),
		[mode, activeVariant, effectiveBody]
	);

	const handleCopyFull = async () => {
		try {
			await navigator.clipboard.writeText(fullPrompt);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			// no-op — clipboard may be blocked
		}
	};

	return (
		<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
			<div className="flex flex-col gap-3 px-4 py-3.5">
				<div className="flex flex-col gap-0.5">
					<span className="text-[13px] font-medium text-[var(--text)]">{title}</span>
					<span className="text-[12px] text-[var(--text-tertiary)]">{subtitle}</span>
				</div>

				<div className="flex items-center justify-between gap-2">
					<div className="flex gap-1 self-start rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5">
						{(["edit", "preview", "full"] as EditorMode[]).map((m) => (
							<button
								key={m}
								type="button"
								onClick={() => setMode(m)}
								className={`rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
									mode === m
										? "bg-[var(--bg-surface)] text-[var(--text)] shadow-sm"
										: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
								}`}
							>
								{TAB_LABEL[m]}
							</button>
						))}
					</div>

					{mode === "full" && (
						<div className="flex items-center gap-2">
							{fullPromptVariants.length > 1 && (
								<div className="flex gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5">
									{fullPromptVariants.map((v) => (
										<button
											key={v.key}
											type="button"
											onClick={() => setVariantKey(v.key)}
											className={`rounded-[4px] px-2 py-0.5 text-[11px] font-medium transition-colors ${
												(activeVariant?.key ?? "") === v.key
													? "bg-[var(--bg-surface)] text-[var(--text)] shadow-sm"
													: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
											}`}
										>
											{v.label}
										</button>
									))}
								</div>
							)}
							<div className="flex gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5">
								{(["plain", "rendered"] as FullPromptView[]).map((v) => (
									<button
										key={v}
										type="button"
										onClick={() => setFullView(v)}
										className={`rounded-[4px] px-2 py-0.5 text-[11px] font-medium transition-colors capitalize ${
											fullView === v
												? "bg-[var(--bg-surface)] text-[var(--text)] shadow-sm"
												: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
										}`}
									>
										{v === "plain" ? "Plain" : "Rendered"}
									</button>
								))}
							</div>
							<button
								type="button"
								onClick={handleCopyFull}
								className="rounded-[5px] border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
							>
								{copied ? "Copied" : "Copy"}
							</button>
						</div>
					)}
				</div>

				{mode === "edit" && (
					<textarea
						value={localValue}
						onChange={(e) => handleEdit(e.target.value)}
						placeholder={defaultPrompt}
						rows={14}
						spellCheck={false}
						className="w-full resize-y rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--text)] placeholder-[var(--text-quaternary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
					/>
				)}

				{mode === "preview" && (
					<div className="min-h-[280px] rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[12px] text-[var(--text)]">
						<MarkdownRenderer content={effectiveBody} className="text-[12px]" />
					</div>
				)}

				{mode === "full" && fullView === "plain" && (
					<pre className="min-h-[280px] max-h-[480px] overflow-auto whitespace-pre-wrap rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
						{fullPrompt}
					</pre>
				)}

				{mode === "full" && fullView === "rendered" && (
					<div className="min-h-[280px] max-h-[480px] overflow-auto rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-[12px] text-[var(--text)]">
						<MarkdownRenderer content={fullPrompt} className="text-[12px]" />
					</div>
				)}

				<div className="flex items-center justify-between">
					<button
						type="button"
						onClick={handleReset}
						className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] underline"
					>
						Reset to default
					</button>
					{value != null && value !== "" && (
						<span className="text-[10px] uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
							Custom
						</span>
					)}
				</div>
			</div>
		</div>
	);
}
