import { useState } from "react";
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

	if (!hasBitbucket && !hasJira) return null;

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
