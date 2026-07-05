import { useReviewModeStore } from "../../stores/review-mode-store";
import { trpc } from "../../trpc/client";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewNavigator } from "./navigator/ReviewNavigator";

const VIEW_LABELS = {
	overview: "Overview",
	changes: "Changes",
	comments: "Comments",
} as const;

export function ReviewModeShell() {
	const active = useReviewModeStore((s) => s.active);
	const view = useReviewModeStore((s) => s.view);
	const navigatorCollapsed = useReviewModeStore((s) => s.navigatorCollapsed);
	const detailsQuery = trpc.projects.getPRDetails.useQuery(
		{
			provider: active?.prCtx.provider ?? "github",
			owner: active?.prCtx.owner ?? "",
			repo: active?.prCtx.repo ?? "",
			number: active?.prCtx.number ?? 0,
		},
		{ enabled: active !== null, staleTime: 30_000 }
	);

	if (!active) return null;

	const details = detailsQuery.data;

	return (
		<div className="fixed inset-0 z-40 flex flex-col bg-[var(--bg-base)]">
			<ReviewHeader prCtx={active.prCtx} commentCount={0} />
			<div className="flex min-h-0 flex-1">
				{!navigatorCollapsed && (
					<aside className="w-[280px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--bg-surface)]">
						{details ? (
							<ReviewNavigator
								workspaceId={active.workspaceId}
								prCtx={active.prCtx}
								details={details}
								threads={[]}
							/>
						) : (
							<div className="p-4 text-[13px] text-[var(--text-tertiary)]">
								{detailsQuery.isLoading
									? "Loading review details..."
									: "Review details unavailable"}
							</div>
						)}
					</aside>
				)}
				<main className="min-w-0 flex-1 p-8 text-[13px] text-[var(--text-tertiary)]">
					{VIEW_LABELS[view]}
				</main>
			</div>
		</div>
	);
}
