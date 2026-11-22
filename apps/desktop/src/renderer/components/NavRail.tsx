import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { QueueIcon } from "./queue/QueueIcon";
const entries = [
	{ segment: "repos", label: "Projects" },
	{ segment: "tickets", label: "Tickets" },
	{ segment: "prs", label: "PRs" },
	{ segment: "hermes", label: "Agents" },
] as const;
/** Shared shell geometry from activity-queue; its Queue feature remains independently owned. */
export function NavRail() {
	const segment = useTabStore((s) => s.sidebarSegment);
	const settings = useProjectStore((s) => s.sidebarView === "settings");
	return (
		<nav
			aria-label="Main navigation"
			className="fixed inset-y-0 left-0 z-30 flex w-[72px] flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
		>
			<div className="app-drag h-[52px] shrink-0" />
			<div className="flex flex-1 flex-col gap-1 px-2 py-2">
				{entries.map((entry) => (
					<button
						key={entry.segment}
						type="button"
						aria-label={entry.label}
						aria-current={!settings && segment === entry.segment ? "page" : undefined}
						onClick={() => {
							useProjectStore.getState().closeSettings();
							useTabStore.getState().setSidebarSegment(entry.segment);
						}}
						className={`flex h-[58px] flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] font-medium focus-visible:outline-[var(--accent)] ${!settings && segment === entry.segment ? "bg-[var(--bg-elevated)] text-[var(--text)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"}`}
					>
						<QueueIcon name={entry.segment} />
						{entry.label}
					</button>
				))}
			</div>
			<button
				type="button"
				aria-label="Settings"
				aria-current={settings ? "page" : undefined}
				onClick={() => useProjectStore.getState().openSettings()}
				className="m-2 flex h-[58px] flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)]"
			>
				<QueueIcon name="settings" />
				Settings
			</button>
		</nav>
	);
}
