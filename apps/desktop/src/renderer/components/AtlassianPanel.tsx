import { useState } from "react";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { JiraIssueList } from "./JiraIssueList";
import { PullRequestList } from "./PullRequestList";
import { SectionHeader } from "./SectionHeader";

export function AtlassianPanel() {
	const { data: status } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const [prOpen, setPrOpen] = useState(true);
	const [jiraOpen, setJiraOpen] = useState(true);

	const hasBitbucket = status?.bitbucket.connected;
	const hasJira = status?.jira.connected;

	if (!hasBitbucket && !hasJira) {
		return (
			<div className="mt-2 border-t border-[var(--border-subtle)] px-3 py-2">
				<span className="text-[12px] text-[var(--text-quaternary)]">
					Connect Jira or Bitbucket to see issues and pull requests.{" "}
				</span>
				<button
					type="button"
					onClick={() => useProjectStore.getState().openSettingsToIntegrations("prs")}
					className="text-[12px] text-[var(--accent)] hover:underline"
				>
					Connect in Settings
				</button>
			</div>
		);
	}

	return (
		<>
			{hasBitbucket && (
				<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
					<SectionHeader
						label="Pull Requests"
						isOpen={prOpen}
						onToggle={() => setPrOpen(!prOpen)}
					/>
					{prOpen && (
						<div className="px-2">
							<PullRequestList />
						</div>
					)}
				</div>
			)}
			{hasJira && (
				<div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
					<SectionHeader label="Jira" isOpen={jiraOpen} onToggle={() => setJiraOpen(!jiraOpen)} />
					{jiraOpen && (
						<div className="px-2">
							<JiraIssueList />
						</div>
					)}
				</div>
			)}
		</>
	);
}
