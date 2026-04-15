import { trpc } from "@/trpc/client";
import { PRIVACY_URL } from "../../../shared/telemetry";
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
	const setAnalyticsEnabled = trpc.telemetry.setAnalyticsEnabled.useMutation({
		onSuccess: () => utils.telemetry.getState.invalidate(),
	});
	const analyticsOn = telemetryState.data?.analyticsEnabled ?? true;

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
					description="Daily snapshot of version, counts, and integration flags."
					checked={analyticsOn}
					onChange={() => setAnalyticsEnabled.mutate({ enabled: !analyticsOn })}
				/>
				<a
					href={PRIVACY_URL}
					target="_blank"
					rel="noreferrer"
					className="block border-t border-[var(--border)] px-4 py-2.5 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--text)] hover:underline"
				>
					Read the privacy notice →
				</a>
			</div>
		</div>
	);
}
