import { useDiffStore } from "../stores/diff";
import { trpc } from "../trpc/client";

export function PullRequestList() {
	const { data: myPRs, isLoading: loadingMy } = trpc.atlassian.getMyPullRequests.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});
	const { data: reviewPRs, isLoading: loadingReviews } = trpc.atlassian.getReviewRequests.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	const setActiveDiff = useDiffStore((s) => s.setActiveDiff);

	const isLoading = loadingMy || loadingReviews;
	const totalCount = (myPRs?.length ?? 0) + (reviewPRs?.length ?? 0);

	if (isLoading && !myPRs && !reviewPRs) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{myPRs && myPRs.length > 0 && (
				<>
					<div className="px-3 py-0.5 text-[11px] font-medium text-[var(--text-quaternary)]">
						My PRs ({myPRs.length})
					</div>
					{myPRs.map((pr) => (
						<div key={`my-${pr.workspace}-${pr.repoSlug}-${pr.id}`} className="flex items-center gap-0.5">
							<button
								type="button"
								onClick={() => window.electron.shell.openExternal(pr.webUrl)}
								className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
								title={`${pr.repoSlug}#${pr.id}: ${pr.title}`}
							>
								<span className="shrink-0 text-[var(--text-quaternary)]">#{pr.id}</span>
								<span className="min-w-0 truncate">{pr.title}</span>
							</button>
							<button
								type="button"
								onClick={() =>
									setActiveDiff({
										type: "pr",
										prId: pr.id,
										workspaceSlug: pr.workspace,
										repoSlug: pr.repoSlug,
										repoPath: "", // TODO: resolve from project list by matching repoSlug
										title: `#${pr.id} ${pr.title}`,
										sourceBranch: pr.source?.branch?.name ?? "",
										targetBranch: pr.destination?.branch?.name ?? "",
									})
								}
								className="shrink-0 rounded px-1.5 py-1 text-[11px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
								title="Open diff viewer"
							>
								⊞
							</button>
						</div>
					))}
				</>
			)}

			{reviewPRs && reviewPRs.length > 0 && (
				<>
					<div className="px-3 py-0.5 text-[11px] font-medium text-[var(--text-quaternary)]">
						Reviews ({reviewPRs.length})
					</div>
					{reviewPRs.map((pr) => (
						<div key={`review-${pr.workspace}-${pr.repoSlug}-${pr.id}`} className="flex items-center gap-0.5">
							<button
								type="button"
								onClick={() => window.electron.shell.openExternal(pr.webUrl)}
								className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
								title={`${pr.repoSlug}#${pr.id}: ${pr.title}`}
							>
								<span className="shrink-0 text-[var(--text-quaternary)]">#{pr.id}</span>
								<span className="min-w-0 truncate">{pr.title}</span>
							</button>
							<button
								type="button"
								onClick={() =>
									setActiveDiff({
										type: "pr",
										prId: pr.id,
										workspaceSlug: pr.workspace,
										repoSlug: pr.repoSlug,
										repoPath: "", // TODO: resolve from project list by matching repoSlug
										title: `#${pr.id} ${pr.title}`,
										sourceBranch: pr.source?.branch?.name ?? "",
										targetBranch: pr.destination?.branch?.name ?? "",
									})
								}
								className="shrink-0 rounded px-1.5 py-1 text-[11px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
								title="Open diff viewer"
							>
								⊞
							</button>
						</div>
					))}
				</>
			)}

			{totalCount === 0 && (
				<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">No pull requests</div>
			)}
		</div>
	);
}
