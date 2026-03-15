import type { GitHubPRContext } from "../../shared/github-types";

export function PROverviewTab({ prCtx }: { prCtx: GitHubPRContext }) {
	return (
		<div className="flex h-full items-center justify-center">
			<div className="text-[13px] text-[var(--text-quaternary)]">
				PR Overview: {prCtx.owner}/{prCtx.repo}#{prCtx.number}
			</div>
		</div>
	);
}
