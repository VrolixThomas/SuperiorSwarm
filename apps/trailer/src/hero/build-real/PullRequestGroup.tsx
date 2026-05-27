// Mirrors apps/desktop/src/renderer/components/PullRequestGroup.tsx. Static, no handlers.

import { type GitHubPREnriched, type MergedPR, RichPRItem } from "./PullRequestItem";
import { RepoGroup } from "./RepoGroup";

interface PullRequestGroupProps {
	owner: string;
	repo: string;
	displayName: string;
	prs: MergedPR[];
	isCollapsed: boolean;
	activePRIdentifier: string | null;
	getPrIdentifier: (pr: MergedPR) => string;
	enrichmentMap: Map<string, GitHubPREnriched>;
	reviewDraftMap: Map<string, { status: string; commentCount: number; roundNumber: number }>;
}

export function PullRequestGroup({
	displayName,
	prs,
	isCollapsed,
	activePRIdentifier,
	getPrIdentifier,
	enrichmentMap,
	reviewDraftMap,
}: PullRequestGroupProps) {
	const isGroupActive =
		activePRIdentifier !== null && prs.some((pr) => getPrIdentifier(pr) === activePRIdentifier);

	return (
		<RepoGroup
			name={displayName}
			isActive={isGroupActive}
			isExpanded={!isCollapsed}
			rightContent={
				<span className="text-[11px] tabular-nums text-[var(--text-quaternary)]">{prs.length}</span>
			}
		>
			{prs.map((pr) => {
				const identifier = getPrIdentifier(pr);
				const isReviewer = pr.provider === "bitbucket";
				const enriched = enrichmentMap.get(identifier);
				const isActive = activePRIdentifier === identifier;

				return (
					<RichPRItem
						key={pr.id}
						pr={pr}
						enriched={enriched}
						isReviewer={isReviewer}
						isActive={isActive}
						agentAlert={undefined}
						reviewStatus={reviewDraftMap.get(identifier) ?? null}
					/>
				);
			})}
		</RepoGroup>
	);
}
