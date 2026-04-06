import type { SidebarSegment } from "../../shared/types";
import { useProjectStore } from "../stores/projects";

export function ConnectBanner({
	message,
	returnTo,
}: {
	message: string;
	returnTo: SidebarSegment;
}) {
	return (
		<>
			<span className="text-[12px] text-[var(--text-quaternary)]">{message} </span>
			<button
				type="button"
				onClick={() => useProjectStore.getState().openSettingsToIntegrations(returnTo)}
				className="text-[12px] text-[var(--accent)] hover:underline"
			>
				Connect in Settings
			</button>
		</>
	);
}
