import { trpc } from "../trpc/client";

export function JiraIssueList() {
	const { data: issues, isLoading } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	if (isLoading && !issues) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (!issues || issues.length === 0) {
		return (
			<div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">No issues assigned</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			{issues.map((issue) => (
				<button
					key={issue.key}
					type="button"
					onClick={() => window.electron.shell.openExternal(issue.webUrl)}
					className="flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					title={`${issue.key}: ${issue.summary}`}
				>
					<span className="shrink-0 font-medium text-[var(--text-quaternary)]">{issue.key}</span>
					<span className="min-w-0 truncate">{issue.summary}</span>
				</button>
			))}
		</div>
	);
}
