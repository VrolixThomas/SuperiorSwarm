import { useMemo, useState } from "react";
import type { LspDetectSuggestion, LspPreset } from "../../../../shared/lsp-schema";

interface LspPresetPickerProps {
	presets: LspPreset[];
	existingIds: Set<string>;
	suggestions?: LspDetectSuggestion[];
	onSelect: (preset: LspPreset) => void;
	onQuickAdd?: (preset: LspPreset) => void;
	onCustom: () => void;
	onCancel: () => void;
}

export function LspPresetPicker({
	presets,
	existingIds,
	suggestions = [],
	onSelect,
	onQuickAdd,
	onCustom,
	onCancel,
}: LspPresetPickerProps) {
	const [search, setSearch] = useState("");

	const presetsById = useMemo(() => new Map(presets.map((p) => [p.id, p])), [presets]);

	const activeSuggestions = useMemo(() => {
		return suggestions
			.map((s) => ({ suggestion: s, preset: presetsById.get(s.id) }))
			.filter(
				(pair): pair is { suggestion: LspDetectSuggestion; preset: LspPreset } =>
					!!pair.preset && !existingIds.has(pair.suggestion.id)
			);
	}, [suggestions, presetsById, existingIds]);

	const suggestedIds = useMemo(
		() => new Set(activeSuggestions.map((s) => s.suggestion.id)),
		[activeSuggestions]
	);

	const filtered = useMemo(() => {
		const list = search.trim()
			? presets.filter((p) => {
					const lower = search.toLowerCase();
					return (
						p.displayName.toLowerCase().includes(lower) ||
						p.description.toLowerCase().includes(lower) ||
						p.config.fileExtensions.some((ext) => ext.includes(lower))
					);
				})
			: presets;
		return list.filter((p) => !suggestedIds.has(p.id));
	}, [presets, search, suggestedIds]);

	return (
		<div>
			<div className="mb-4">
				<div className="text-[15px] font-semibold text-[var(--text)]">Add Language Server</div>
				<div className="text-[11px] text-[var(--text-tertiary)]">
					Choose a language or configure a custom server
				</div>
			</div>

			<input
				type="text"
				placeholder="Search languages..."
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				className="mb-3 w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:outline-none"
			/>

			{activeSuggestions.length > 0 && !search.trim() && (
				<div className="mb-3">
					<div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
						Suggested for this repo
					</div>
					<div className="overflow-hidden rounded-[8px] border border-[var(--border)]">
						{activeSuggestions.map(({ suggestion, preset }) => (
							<SuggestionRow
								key={suggestion.id}
								suggestion={suggestion}
								preset={preset}
								onAdd={onQuickAdd ?? onSelect}
								onConfigure={onSelect}
							/>
						))}
					</div>
				</div>
			)}

			<div className="max-h-[280px] overflow-y-auto rounded-[8px] border border-[var(--border)]">
				{filtered.map((preset) => {
					const alreadyAdded = existingIds.has(preset.id);
					return (
						<button
							key={preset.id}
							type="button"
							disabled={alreadyAdded}
							onClick={() => onSelect(preset)}
							className="flex w-full items-start border-b border-[var(--border-subtle)] px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-40"
						>
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<span className="text-[12px] font-medium text-[var(--text)]">
										{preset.displayName}
									</span>
									{alreadyAdded && (
										<span className="text-[9px] text-[var(--text-quaternary)]">Already added</span>
									)}
								</div>
								<div className="text-[10px] text-[var(--text-quaternary)]">
									{preset.description} · {preset.config.fileExtensions.join(", ")}
								</div>
							</div>
						</button>
					);
				})}
				<button
					type="button"
					onClick={onCustom}
					className="flex w-full items-start px-3 py-2 text-left transition-colors hover:bg-[var(--bg-elevated)]"
				>
					<div>
						<div className="text-[12px] font-medium text-[#8888ff]">Custom Server...</div>
						<div className="text-[10px] text-[var(--text-quaternary)]">
							Configure a server manually
						</div>
					</div>
				</button>
			</div>

			<div className="mt-3 flex justify-end">
				<button
					type="button"
					onClick={onCancel}
					className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-1.5 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
				>
					Cancel
				</button>
			</div>
		</div>
	);
}

function SuggestionRow({
	suggestion,
	preset,
	onAdd,
	onConfigure,
}: {
	suggestion: LspDetectSuggestion;
	preset: LspPreset;
	onAdd: (preset: LspPreset) => void;
	onConfigure: (preset: LspPreset) => void;
}) {
	return (
		<div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-[12px] font-medium text-[var(--text)]">
						{suggestion.displayName}
					</span>
					<span className="rounded-full bg-[rgba(100,100,255,0.15)] px-1.5 py-0 text-[9px] font-medium text-[#8888ff]">
						{suggestion.fileCount} {suggestion.fileCount === 1 ? "file" : "files"}
					</span>
				</div>
				{suggestion.sampleFiles.length > 0 && (
					<div className="truncate font-mono text-[10px] text-[var(--text-quaternary)]">
						{suggestion.sampleFiles.join(" · ")}
					</div>
				)}
			</div>
			<button
				type="button"
				onClick={() => onConfigure(preset)}
				className="shrink-0 rounded-[4px] border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
			>
				Configure
			</button>
			<button
				type="button"
				onClick={() => onAdd(preset)}
				className="shrink-0 rounded-[4px] bg-[var(--accent)] px-2 py-0.5 text-[10px] text-white hover:opacity-90"
			>
				Add
			</button>
		</div>
	);
}
