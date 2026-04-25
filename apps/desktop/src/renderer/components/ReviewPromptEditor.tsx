import { useEffect, useState } from "react";
import { DEFAULT_REVIEW_GUIDELINES } from "../../shared/review-prompt";
import { trpc } from "../trpc/client";

export function ReviewPromptEditor({ onBack }: { onBack: () => void }) {
	const utils = trpc.useUtils();
	const { data: settings } = trpc.aiReview.getSettings.useQuery(undefined, {
		staleTime: 30_000,
	});
	const updateSettings = trpc.aiReview.updateSettings.useMutation({
		onSuccess: () => utils.aiReview.getSettings.invalidate(),
	});

	const [value, setValue] = useState("");
	const [dirty, setDirty] = useState(false);

	// Initialize textarea when settings load
	useEffect(() => {
		if (settings) {
			setValue(settings.customPrompt ?? DEFAULT_REVIEW_GUIDELINES);
		}
	}, [settings]);

	const handleSave = () => {
		updateSettings.mutate({ customPrompt: value });
		setDirty(false);
	};

	const handleReset = () => {
		updateSettings.mutate({ customPrompt: null });
		setValue(DEFAULT_REVIEW_GUIDELINES);
		setDirty(false);
	};

	const handleChange = (newValue: string) => {
		setValue(newValue);
		setDirty(true);
	};

	const isCustom = settings?.customPrompt != null;

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center gap-2 px-3 pb-3">
				<button
					type="button"
					onClick={onBack}
					className="flex size-7 items-center justify-center rounded-[6px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
						<path
							d="M10 3L5 8l5 5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<span className="flex-1 text-[13px] font-semibold text-[var(--text)]">
					Review Guidelines
				</span>
				{isCustom && (
					<button
						type="button"
						onClick={handleReset}
						className="rounded-[5px] border border-[var(--border)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-elevated)]"
					>
						Reset to Default
					</button>
				)}
				<button
					type="button"
					onClick={handleSave}
					disabled={!dirty || updateSettings.isPending}
					className="rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
				>
					{updateSettings.isPending ? "Saving..." : "Save"}
				</button>
			</div>

			<div className="flex flex-1 flex-col gap-3 overflow-y-auto px-3">
				{/* Editable guidelines */}
				<div className="flex flex-1 flex-col gap-1">
					<span className="text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						Your Review Instructions
					</span>
					<textarea
						value={value}
						onChange={(e) => handleChange(e.target.value)}
						spellCheck={false}
						className="min-h-[200px] flex-1 resize-y rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] p-3 font-mono text-[12px] leading-relaxed text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)]"
						placeholder="Enter your review guidelines..."
					/>
				</div>

				{/* Locked MCP preview */}
				<div className="flex shrink-0 flex-col gap-1 pb-3">
					<span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
						<svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
							<path d="M4 7V5a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1zm2 0h4V5a2 2 0 1 0-4 0v2z" />
						</svg>
						MCP Tool Instructions (always appended)
					</span>
					<div className="rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-mono text-[11px] leading-relaxed text-[var(--text-quaternary)] opacity-70">
						<p>1. Call `get_pr_metadata` to get PR context</p>
						<p>2. Explore codebase and review changes via git diff</p>
						<p>3. Call `add_draft_comment` for each issue found</p>
						<p>
							4. Call `set_review_summary` with markdown summary (overview, changes per file, risk,
							recommendations)
						</p>
						<p>5. Call `finish_review` when done</p>
					</div>
				</div>
			</div>
		</div>
	);
}
