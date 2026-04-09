import type { Project } from "../../main/db/schema";
import type { AgentAlert } from "../../shared/agent-events";
import type { GitHubPREnriched } from "../../shared/github-types";
import { type MergedPR, RichPRItem } from "./PullRequestItem";
import { RepoGroup } from "./RepoGroup";
import { resolveDisplayName } from "./pr-panel-helpers";

interface PullRequestGroupProps {
	repoKey: string;
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
			<div className="flex flex-col">
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
							isInActiveGroup={isGroupActive}
							identifier={identifier}
							agentAlert={agentAlert}
							projectsList={projectsList}
							onClick={(e) => onPRClick(pr, e)}
							onContextMenu={(e) => onPRContextMenu(pr, e)}
						/>
					);
				})}
			</div>
		</RepoGroup>
	);
}
