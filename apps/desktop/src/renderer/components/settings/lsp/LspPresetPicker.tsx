import { useMemo, useState } from "react";
import type { LspPreset } from "../../../../shared/lsp-types";

interface LspPresetPickerProps {
	presets: LspPreset[];
	existingIds: Set<string>;
	onSelect: (preset: LspPreset) => void;
	onCustom: () => void;
	onCancel: () => void;
}

export function LspPresetPicker({
	presets,
	existingIds,
	onSelect,
	onCustom,
	onCancel,
}: LspPresetPickerProps) {
	const [search, setSearch] = useState("");

	const filtered = useMemo(() => {
		if (!search.trim()) return presets;
		const lower = search.toLowerCase();
		return presets.filter(
			(p) =>
				p.displayName.toLowerCase().includes(lower) ||
				p.description.toLowerCase().includes(lower) ||
				p.config.fileExtensions.some((ext) => ext.includes(lower))
		);
	}, [presets, search]);

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
