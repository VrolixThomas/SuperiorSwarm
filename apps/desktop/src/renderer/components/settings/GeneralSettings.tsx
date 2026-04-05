import { useEditorSettingsStore } from "../../stores/editor-settings";
import { Toggle } from "./Toggle";

export function GeneralSettings() {
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);
	const setVimEnabled = useEditorSettingsStore((s) => s.setVimEnabled);

	return (
		<div>
			<h1 className="text-[20px] font-semibold text-[var(--text)]">General</h1>
			<p className="mb-8 mt-1 text-[13px] text-[var(--text-tertiary)]">
				App preferences and editor configuration
			</p>

			<div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
				Editor
			</div>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<div className="flex items-center justify-between px-4 py-3.5">
					<div className="flex flex-col gap-0.5">
						<span className="text-[13px] font-medium text-[var(--text)]">Vim Mode</span>
						<span className="text-[12px] text-[var(--text-tertiary)]">
							Vim keybindings in code editors
						</span>
					</div>
					<Toggle checked={vimEnabled} onChange={() => setVimEnabled(!vimEnabled)} />
				</div>
			</div>
		</div>
	);
}
