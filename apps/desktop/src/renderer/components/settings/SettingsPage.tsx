import { useEffect } from "react";
import { useProjectStore } from "../../stores/projects";
import { AIReviewSettings } from "./AIReviewSettings";
import { AboutSettings } from "./AboutSettings";
import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";
import { GeneralSettings } from "./GeneralSettings";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { SettingsNav } from "./SettingsNav";
import { TerminalsSettings } from "./TerminalsSettings";

function SettingsContent() {
	const category = useProjectStore((s) => s.settingsCategory);

	switch (category) {
		case "general":
			return <GeneralSettings />;
		case "integrations":
			return <IntegrationsSettings />;
		case "ai-review":
			return <AIReviewSettings />;
		case "shortcuts":
			return <KeyboardShortcutsSettings />;
		case "terminals":
			return <TerminalsSettings />;
		case "about":
			return <AboutSettings />;
		default: {
			const _exhaustive: never = category;
			return _exhaustive;
		}
	}
}

export function SettingsPage() {
	const closeSettings = useProjectStore((s) => s.closeSettings);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				closeSettings();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [closeSettings]);

	return (
		<div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
			<SettingsNav />
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[640px] px-12 py-8 pt-[84px]">
					<SettingsContent />
				</div>
			</div>
		</div>
	);
}
