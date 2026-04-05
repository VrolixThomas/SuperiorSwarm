import { useEditorSettingsStore } from "../../stores/editor-settings";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

export function GeneralSettings() {
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);
	const setVimEnabled = useEditorSettingsStore((s) => s.setVimEnabled);

	return (
		<div>
			<PageHeading title="General" subtitle="App preferences and editor configuration" />

			<SectionLabel>Editor</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<ToggleRow
					label="Vim Mode"
					description="Vim keybindings in code editors"
					checked={vimEnabled}
					onChange={() => setVimEnabled(!vimEnabled)}
				/>
			</div>
		</div>
	);
}
