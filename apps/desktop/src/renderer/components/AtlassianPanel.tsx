import { useState } from "react";
import { trpc } from "../trpc/client";
import { JiraIssueList } from "./JiraIssueList";
import { PullRequestList } from "./PullRequestList";

function SectionHeader({
	label,
	count,
	isOpen,
	onToggle,
}: {
	label: string;
	count?: number;
	isOpen: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			className="flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)] transition-colors hover:text-[var(--text-tertiary)]"
		>
			<svg
				aria-hidden="true"
				width="10"
				height="10"
				viewBox="0 0 10 10"
				fill="none"
				className={`shrink-0 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}
			>
				<path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			<span>{label}</span>
			{count !== undefined && count > 0 && (
				<span className="ml-auto text-[10px] tabular-nums">{count}</span>
			)}
		</button>
	);
}

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
			{status?.bitbucket.connected && (
				<div>
					<SectionHeader label="Pull Requests" isOpen={prOpen} onToggle={() => setPrOpen(!prOpen)} />
					{prOpen && (
						<div className="px-2">
							<PullRequestList />
						</div>
					)}
				</div>
			)}
			{status?.jira.connected && (
				<div>
					<SectionHeader label="Jira" isOpen={jiraOpen} onToggle={() => setJiraOpen(!jiraOpen)} />
					{jiraOpen && (
						<div className="px-2">
							<JiraIssueList />
						</div>
					)}
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
