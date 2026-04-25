import { trpc } from "@/trpc/client";
import { PRIVACY_URL } from "../../../shared/telemetry";
import type { ThemePref } from "../../../shared/types";
import { useEditorSettingsStore } from "../../stores/editor-settings";
import { useThemeStore } from "../../stores/theme-store";
import { PageHeading, SectionLabel } from "./SectionHeading";
import { ToggleRow } from "./ToggleRow";

const themeOptions: { value: ThemePref; label: string; description: string }[] = [
	{ value: "light", label: "Light", description: "Always use the light theme" },
	{ value: "dark", label: "Dark", description: "Always use the dark theme" },
	{ value: "system", label: "System", description: "Match the operating system appearance" },
];

export function GeneralSettings() {
	const vimEnabled = useEditorSettingsStore((s) => s.vimEnabled);
	const setVimEnabled = useEditorSettingsStore((s) => s.setVimEnabled);
	const notificationSoundsEnabled = useEditorSettingsStore((s) => s.notificationSoundsEnabled);
	const setNotificationSoundsEnabled = useEditorSettingsStore(
		(s) => s.setNotificationSoundsEnabled
	);

	const themePref = useThemeStore((s) => s.pref);
	const setThemePref = useThemeStore((s) => s.setPref);

	const telemetryState = trpc.telemetry.getState.useQuery();
	const utils = trpc.useUtils();
	const setAnalyticsEnabled = trpc.telemetry.setAnalyticsEnabled.useMutation({
		onSuccess: () => utils.telemetry.getState.invalidate(),
	});
	const analyticsOn = telemetryState.data?.analyticsEnabled ?? true;

	return (
		<div>
			<PageHeading title="General" subtitle="App preferences and editor configuration" />

			<SectionLabel>Appearance</SectionLabel>
			<div className="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
				{themeOptions.map((opt, i) => (
					<button
						key={opt.value}
						type="button"
						onClick={() => {
							void setThemePref(opt.value);
						}}
						className={`flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-[var(--bg-overlay)] ${
							i > 0 ? "border-t border-[var(--border)]" : ""
						}`}
					>
						<div className="flex flex-col">
							<span className="text-[13px] text-[var(--text)]">{opt.label}</span>
							<span className="text-[12px] text-[var(--text-tertiary)]">{opt.description}</span>
						</div>
						<div className="flex size-4 shrink-0 items-center justify-center rounded-full border border-[var(--border-active)]">
							{themePref === opt.value && (
								<div className="size-2 rounded-full bg-[var(--accent)]" />
							)}
						</div>
					</button>
				))}
			</div>

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
