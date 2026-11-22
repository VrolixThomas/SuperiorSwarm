import { useRememberedReviewPath } from "../../../lib/review-path-status-cache";
import { type ReviewQueueFacts, type ReviewQueuePR, queueStatus } from "../../../lib/review-queue";
import { trpc } from "../../../trpc/client";
export function PRQueueRow({
	pr,
	current,
	next,
	openingKey,
	facts,
	onSelect,
}: {
	pr: ReviewQueuePR;
	current: boolean;
	next: boolean;
	openingKey?: string | null;
	facts?: ReviewQueueFacts;
	onSelect: (pr: ReviewQueuePR) => void;
}) {
	const scope = {
		provider: pr.provider,
		owner: pr.owner,
		repo: pr.repo,
		prNumber: pr.number,
		headSha: pr.headCommitSha ?? "",
		projectId: pr.projectId,
	};
	const enabled = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(scope.headSha);
	const remembered = useRememberedReviewPath(enabled ? scope : undefined);
	const projection = trpc.reviewPath.status.useQuery(scope, {
		enabled,
		staleTime: 15_000,
		refetchInterval: (query) => (query.state.data?.status === "mapping" ? 3000 : false),
		refetchOnWindowFocus: false,
	});
	const matched = projection.data?.identity;
	const pathStatus =
		matched?.headSha === pr.headCommitSha &&
		matched?.provider === pr.provider &&
		matched.owner === pr.owner &&
		matched.repo === pr.repo &&
		matched.prNumber === pr.number
			? projection.data?.status
			: projection.data === null || projection.isError
				? undefined
				: remembered?.path?.status;
	const status = queueStatus({
		headCommitSha: pr.headCommitSha,
		pathStatus,
		...facts,
	});
	const date = pr.updatedAt ? new Date(pr.updatedAt) : null;
	const updated =
		date && !Number.isNaN(date.getTime())
			? date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
			: null;
	// List caches use zero before details are fetched; it is not a known empty diff.
	const fileCount = facts?.changedFiles ?? facts?.viewed?.total ?? pr.fileCount;
	return (
		<button
			type="button"
			data-pr-key={pr.key}
			aria-current={current ? "page" : undefined}
			disabled={!!openingKey}
			onClick={() => onSelect(pr)}
			className={`group grid w-full grid-cols-[minmax(0,1fr)_140px] items-center gap-[20px] border-b border-[var(--border-subtle)] px-[20px] py-[16px] text-left transition-colors disabled:cursor-wait min-[1000px]:grid-cols-[minmax(0,1fr)_150px_140px] ${current ? "bg-[var(--bg-overlay)]" : "hover:bg-[var(--bg-elevated)]"}`}
		>
			<span className="min-w-0">
				<span className="mb-[6px] flex items-center gap-[8px] text-[11px] text-[var(--text-tertiary)]">
					<span className="truncate">
						{pr.owner}/{pr.repo}
					</span>
					<span>#{pr.number}</span>
					{current && (
						<span className="rounded bg-[var(--accent-subtle)] px-[6px] py-[2px] text-[var(--accent-hover)]">
							Current review
						</span>
					)}
					{next && !current && (
						<span className="rounded bg-[var(--bg-elevated)] px-[6px] py-[2px]">Next</span>
					)}
				</span>
				<span className="line-clamp-2 text-[14px] font-medium leading-[20px] text-[var(--text)]">
					{pr.title}
				</span>
				<span className="mt-[6px] flex flex-wrap items-center gap-x-[12px] gap-y-[3px] text-[12px] text-[var(--text-secondary)]">
					{pr.author && <span>{pr.author}</span>}
					{fileCount != null && fileCount > 0 && (
						<span className="text-[var(--text-tertiary)]">{fileCount} files</span>
					)}
					{pr.isDraft && <span className="text-[var(--text-tertiary)]">Draft</span>}
				</span>
			</span>
			<span className="hidden min-w-0 text-[12px] text-[var(--text-tertiary)] min-[1000px]:block">
				<span className="block">{pr.provider === "github" ? "GitHub" : "Bitbucket"}</span>
				{updated && (
					<span className="mt-[4px] block" title={pr.updatedAt}>
						Updated {updated}
					</span>
				)}
			</span>
			<span
				className={`justify-self-end rounded-[6px] border border-[var(--border-subtle)] px-[9px] py-[5px] text-[12px] ${status.tone === "accent" ? "text-[var(--accent-hover)]" : status.tone === "warning" ? "text-[var(--tag-amber-fg)]" : "text-[var(--text-secondary)]"}`}
			>
				{openingKey === pr.key
					? "Opening…"
					: status.label === "Status unavailable"
						? "Open to inspect"
						: status.label}
				<span aria-hidden="true" className="ml-[8px]">
					›
				</span>
			</span>
		</button>
	);
}
