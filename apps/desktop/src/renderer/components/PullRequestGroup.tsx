import type { Project } from "../../main/db/schema";
import type { AgentAlert } from "../../shared/agent-events";
import type { GitHubPREnriched } from "../../shared/github-types";
import { type MergedPR, RichPRItem } from "./PullRequestItem";
import { RepoGroup } from "./RepoGroup";
import { resolveDisplayName } from "./pr-panel-helpers";

interface PullRequestGroupProps {
	owner: string;
	repo: string;
	prs: MergedPR[];
	isCollapsed: boolean;
	onToggleCollapse: () => void;
	activePRIdentifier: string | null;
	getPrIdentifier: (pr: MergedPR) => string;

	// Forwarded into each RichPRItem
	enrichmentMap: Map<string, GitHubPREnriched>;
	enrichmentLoading: boolean;
	agentAlerts: Record<string, AgentAlert>;
	workspaceIdMap: Map<string, string>;
	projectsList: Project[] | undefined;
	reviewDraftMap: Map<string, { status: string; commentCount: number; roundNumber: number }>;
	onPRClick: (pr: MergedPR, e: React.MouseEvent) => void;
	onPRContextMenu: (pr: MergedPR, e: React.MouseEvent) => void;
}

export function PullRequestGroup({
	owner,
	repo,
	prs,
	isCollapsed,
	onToggleCollapse,
	activePRIdentifier,
	getPrIdentifier,
	enrichmentMap,
	enrichmentLoading,
	agentAlerts,
	workspaceIdMap,
	projectsList,
	reviewDraftMap,
	onPRClick,
	onPRContextMenu,
}: PullRequestGroupProps) {
	const displayName = resolveDisplayName({ owner, repo }, projectsList);
	const isGroupActive =
		activePRIdentifier !== null && prs.some((pr) => getPrIdentifier(pr) === activePRIdentifier);

	return (
		<RepoGroup
			name={displayName}
			isActive={isGroupActive}
			isExpanded={!isCollapsed}
			onToggle={onToggleCollapse}
			rightContent={
				<span className="text-[11px] tabular-nums text-[var(--text-quaternary)]">{prs.length}</span>
			}
		>
			{prs.map((pr) => {
				const identifier = getPrIdentifier(pr);
				const isReviewer = pr.githubPR?.role === "reviewer" || pr.provider === "bitbucket";
				const enriched = enrichmentMap.get(identifier);
				const knownWorkspaceId = workspaceIdMap.get(identifier);
				const agentAlert = knownWorkspaceId ? agentAlerts[knownWorkspaceId] : undefined;
				const isActive = activePRIdentifier === identifier;

				return (
					<RichPRItem
						key={pr.id}
						pr={pr}
						enriched={enriched}
						enrichmentLoading={enrichmentLoading}
						isReviewer={isReviewer}
						isActive={isActive}
						agentAlert={agentAlert}
						projectsList={projectsList}
						reviewStatus={reviewDraftMap.get(identifier) ?? null}
						onClick={(e) => onPRClick(pr, e)}
						onContextMenu={(e) => onPRContextMenu(pr, e)}
					/>
				);
			})}
		</RepoGroup>
	);
}
