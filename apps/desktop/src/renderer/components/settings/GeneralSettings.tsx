import { trpc } from "@/trpc/client";
import { useEditorSettingsStore } from "../../stores/editor-settings";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

export function GeneralSettings() {
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);
	const setVimEnabled = useEditorSettingsStore((s) => s.setVimEnabled);
	const notificationSoundsEnabled = useEditorSettingsStore((s) => s.notificationSoundsEnabled);
	const setNotificationSoundsEnabled = useEditorSettingsStore(
		(s) => s.setNotificationSoundsEnabled
	);

	const telemetryState = trpc.telemetry.getState.useQuery();
	const utils = trpc.useUtils();
	const setOptOut = trpc.telemetry.setOptOut.useMutation({
		onSuccess: () => utils.telemetry.getState.invalidate(),
	});
	const analyticsOn = !(telemetryState.data?.optOut ?? false);

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

			<SectionLabel>Notifications</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<ToggleRow
					label="Notification Sounds"
					description="Play sounds for agent events like task completion and needs-input"
					checked={notificationSoundsEnabled}
					onChange={() => setNotificationSoundsEnabled(!notificationSoundsEnabled)}
				/>
			</div>

			<SectionLabel>Usage analytics</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				<ToggleRow
					label="Send usage analytics"
					description="Send a daily non-PII snapshot (version, counts, integration flags). No code, prompts, or personal info."
					checked={analyticsOn}
					onChange={() => setOptOut.mutate({ optOut: analyticsOn })}
				/>
			</div>
			<p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
				<a
					href="https://github.com/VrolixThomas/SuperiorSwarm/blob/main/PRIVACY.md"
					target="_blank"
					rel="noreferrer"
					className="underline"
				>
					Read the privacy notice
				</a>
			</p>
		</div>
	);
}
