import type { SidebarSegment } from "../../shared/types";
import { useActivityQueueStore } from "../stores/activity-queue-store";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { useUpdateStore } from "../stores/update-store";
import { trpc } from "../trpc/client";
import { Tooltip } from "./Tooltip";
import { QueueIcon } from "./queue/QueueIcon";

const entries = [
	{ segment: "queue", label: "Queue", action: "nav.queue" },
	{ segment: "repos", label: "Projects", action: "nav.repos" },
	{ segment: "tickets", label: "Tickets", action: "nav.tickets" },
	{ segment: "prs", label: "PRs", action: "nav.prs" },
	{ segment: "hermes", label: "Agents", action: "nav.hermes" },
] as const;
export function NavRail() {
	const segment = useTabStore((s) => s.sidebarSegment);
	const settings = useProjectStore((s) => s.sidebarView === "settings");
	const count = useActivityQueueStore((s) => s.pendingCount);
	const unavailable = useActivityQueueStore((s) => s.unavailable);
	const update = useUpdateStore((s) => s.dismissedUpdateVersion !== null);
	const drafts = trpc.aiReview.getReviewDrafts.useQuery(undefined, { staleTime: 5_000 });
	const prs = trpc.prPoller.getCachedPRs.useQuery(undefined, {
		staleTime: 10_000,
		refetchInterval: 30_000,
	});
	const prDot =
		(drafts.data ?? []).some((d) => d.status === "ready" || d.status === "failed") ||
		(prs.data?.length ?? 0) > 0;
	const navigate = (next: SidebarSegment) => {
		useProjectStore.getState().closeSettings();
		if (next === "queue") useActivityQueueStore.getState().show();
		else {
			useActivityQueueStore.setState({ open: false });
			useTabStore.getState().setSidebarSegment(next);
		}
	};
	return (
		<nav
			aria-label="Main navigation"
			className="fixed inset-y-0 left-0 z-10 flex w-[72px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
		>
			<div className="app-drag h-[52px] shrink-0" />
			<div className="flex flex-1 flex-col items-stretch gap-1 px-2 py-2">
				{entries.map(({ segment: next, label, action }) => (
					<div
						key={next}
						className={next === "repos" ? "mt-2 border-t border-[var(--border-subtle)] pt-3" : ""}
					>
						<Tooltip label={label} actionId={action}>
							<button
								type="button"
								aria-label={
									next === "queue"
										? count === null
											? unavailable
												? "Queue unavailable"
												: "Queue loading"
											: `Queue ${count}`
										: label
								}
								data-queue-trigger={next === "queue" ? "" : undefined}
								aria-current={!settings && segment === next ? "page" : undefined}
								onClick={() => navigate(next)}
								className={`relative flex h-[58px] w-full flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] font-medium outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${!settings && segment === next ? "bg-[var(--bg-elevated)] text-[var(--text)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]"}`}
							>
								<QueueIcon name={next} />
								<span>{label}</span>
								{next === "queue" && count !== null && count > 0 && !unavailable && (
									<span className="absolute right-0.5 top-0.5 min-w-3.5 rounded-full bg-[var(--accent)] px-1 text-[9px] leading-4 text-[var(--accent-foreground)]">
										{count > 99 ? "99+" : count}
									</span>
								)}
								{next === "queue" && unavailable && (
									<span className="absolute right-1 top-1 text-[10px] text-[var(--st-blocked)]">
										!
									</span>
								)}
								{next === "prs" && prDot && segment !== "prs" && (
									<span className="absolute right-2 top-2 size-1.5 rounded-full bg-[var(--st-working)]" />
								)}
							</button>
						</Tooltip>
					</div>
				))}
			</div>
			<div className="border-t border-[var(--border-subtle)] px-2 py-3">
				<Tooltip label="Settings" actionId="general.settings">
					<button
						type="button"
						aria-label="Settings"
						aria-current={settings ? "page" : undefined}
						onClick={() => useProjectStore.getState().openSettings()}
						className={`relative flex h-[58px] w-full flex-col items-center justify-center gap-1.5 rounded-lg text-[10px] outline-offset-2 hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${settings ? "text-[var(--text)] bg-[var(--bg-elevated)]" : "text-[var(--text-tertiary)]"}`}
					>
						<QueueIcon name="settings" />
						<span>Settings</span>
						{update && (
							<span className="absolute right-2 top-2 size-1.5 rounded-full bg-[var(--st-working)]" />
						)}
					</button>
				</Tooltip>
			</div>
		</nav>
	);
}
