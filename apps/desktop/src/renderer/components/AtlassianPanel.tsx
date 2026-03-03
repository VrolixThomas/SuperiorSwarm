import { useState } from "react";
import { trpc } from "../trpc/client";
import { JiraIssueList } from "./JiraIssueList";
import { PullRequestList } from "./PullRequestList";
import { SectionHeader } from "./SectionHeader";

export function AtlassianPanel() {
	const { data: status } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const utils = trpc.useUtils();
	const connectMutation = trpc.atlassian.connect.useMutation({
		onSuccess: () => {
			utils.atlassian.getStatus.invalidate();
		},
	});
	const disconnectMutation = trpc.atlassian.disconnect.useMutation({
		onSuccess: () => {
			utils.atlassian.getStatus.invalidate();
			utils.atlassian.getMyPullRequests.invalidate();
			utils.atlassian.getReviewRequests.invalidate();
			utils.atlassian.getMyIssues.invalidate();
		},
	});

	const [prOpen, setPrOpen] = useState(true);
	const [jiraOpen, setJiraOpen] = useState(true);

	const isConnected = status?.jira.connected || status?.bitbucket.connected;

	if (!isConnected) {
		return (
			<div className="px-2 py-1">
				<button
					type="button"
					onClick={() => connectMutation.mutate({ service: "all" })}
					disabled={connectMutation.isPending}
					className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
				>
					{connectMutation.isPending ? "Connecting..." : "Connect Atlassian"}
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			{status?.bitbucket.connected ? (
				<div>
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
			) : (
				<div className="px-2 py-0.5">
					<button
						type="button"
						onClick={() => connectMutation.mutate({ service: "bitbucket" })}
						disabled={connectMutation.isPending}
						className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					>
						{connectMutation.isPending ? "Connecting..." : "Connect Bitbucket"}
					</button>
				</div>
			)}
			{status?.jira.connected ? (
				<div>
					<SectionHeader label="Jira" isOpen={jiraOpen} onToggle={() => setJiraOpen(!jiraOpen)} />
					{jiraOpen && (
						<div className="px-2">
							<JiraIssueList />
						</div>
					)}
				</div>
			) : (
				<div className="px-2 py-0.5">
					<button
						type="button"
						onClick={() => connectMutation.mutate({ service: "jira" })}
						disabled={connectMutation.isPending}
						className="flex w-full items-center gap-2 rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					>
						{connectMutation.isPending ? "Connecting..." : "Connect Jira"}
					</button>
				</div>
			)}
			<div className="px-3 py-1">
				<button
					type="button"
					onClick={() => disconnectMutation.mutate({ service: "all" })}
					className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-tertiary)]"
				>
					Disconnect Atlassian
				</button>
			</div>
		</div>
	);
}
