import { useCallback, useEffect } from "react";
import type { MergedTicketIssue } from "../../../shared/tickets";
import { formatRelativeTime } from "../../../shared/tickets";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { StateIcon } from "../StateIcon";
import type { LinkedWorkspace } from "../WorkspacePopover";

interface TicketDetailPanelProps {
	issue: MergedTicketIssue;
	linked: LinkedWorkspace[] | undefined;
	onCreateBranch: () => void;
	onNavigateToWorkspace: (ws: LinkedWorkspace) => void;
}

export function TicketDetailPanel({
	issue,
	linked,
	onCreateBranch,
	onNavigateToWorkspace,
}: TicketDetailPanelProps) {
	const closeTicketDetail = useTabStore((s) => s.closeTicketDetail);
	const utils = trpc.useUtils();

	const { data: jiraDetail } = trpc.atlassian.getIssueDetail.useQuery(
		{ issueKey: issue.id },
		{
			enabled: issue.provider === "jira",
			staleTime: 60_000,
		}
	);

	const { data: linearDetail } = trpc.linear.getIssueDetail.useQuery(
		{ issueId: issue.id },
		{
			enabled: issue.provider === "linear",
			staleTime: 60_000,
		}
	);

	const detail = issue.provider === "jira" ? jiraDetail : linearDetail;

	const { data: linearStates } = trpc.linear.getTeamStates.useQuery(
		{ teamId: issue.groupId },
		{
			enabled: issue.provider === "linear",
			staleTime: 5 * 60_000,
		}
	);

	const { data: jiraTransitions } = trpc.atlassian.getIssueTransitions.useQuery(
		{ issueKey: issue.id },
		{
			enabled: issue.provider === "jira",
			staleTime: 60_000,
		}
	);

	const updateLinearState = trpc.linear.updateIssueState.useMutation({
		onSettled: () => utils.linear.getAssignedIssues.invalidate(),
	});
	const updateJiraStatus = trpc.atlassian.updateIssueStatus.useMutation({
		onSettled: () => utils.atlassian.getMyIssues.invalidate(),
	});

	const states = issue.provider === "linear" ? linearStates : jiraTransitions;

	const handleStatusChange = useCallback(
		(stateOrTransitionId: string) => {
			if (issue.provider === "linear") {
				updateLinearState.mutate({ issueId: issue.id, stateId: stateOrTransitionId });
			} else {
				updateJiraStatus.mutate({ issueKey: issue.id, transitionId: stateOrTransitionId });
			}
		},
		[issue, updateLinearState, updateJiraStatus]
	);

	useEffect(() => {
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeTicketDetail();
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [closeTicketDetail]);

	const providerLabel = issue.provider === "jira" ? "Jira" : "Linear";
	const projectLabel = issue.teamName || issue.projectKey || issue.groupId;

	return (
		<div className="flex h-full flex-col bg-[#111]">
			<div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-5 py-2.5">
				<StateIcon type={issue.stateType || "default"} color={issue.status.color} size={10} />
				<span className="text-[13px] font-semibold text-[var(--text)]">{issue.identifier}</span>
				<span className="rounded-full bg-[rgba(255,255,255,0.06)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]">
					{issue.status.name}
				</span>
				<span className="text-[10px] text-[var(--text-quaternary)]">
					{providerLabel} · {projectLabel}
				</span>
				<div className="flex-1" />
				<button
					type="button"
					onClick={() => window.electron.shell.openExternal(issue.url)}
					className="rounded-[4px] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
				>
					Open in {providerLabel} ↗
				</button>
				<button
					type="button"
					onClick={closeTicketDetail}
					className="rounded-[4px] bg-[var(--bg-elevated)] px-2 py-1 text-[10px] text-[var(--text-quaternary)]"
				>
					Esc
				</button>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="flex-1 overflow-y-auto px-5 py-4">
					<h2 className="text-[16px] font-semibold leading-[1.3] text-[var(--text)]">
						{issue.title}
					</h2>
					{detail?.description && (
						<p className="mt-3 whitespace-pre-wrap text-[12px] leading-[1.7] text-[var(--text-secondary)]">
							{detail.description}
						</p>
					)}
					{detail?.comments && detail.comments.length > 0 && (
						<>
							<div className="my-4 h-px bg-[rgba(255,255,255,0.04)]" />
							<div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.3px] text-[var(--text-tertiary)]">
								Activity
							</div>
							<div className="flex flex-col gap-3">
								{detail.comments.map((comment) => (
									<div key={comment.id} className="flex gap-2">
										<div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-overlay)] text-[9px] font-semibold text-[var(--text-tertiary)]">
											{comment.author.slice(0, 2).toUpperCase()}
										</div>
										<div className="min-w-0 flex-1">
											<div className="text-[11px]">
												<span className="font-medium text-[var(--text)]">{comment.author}</span>{" "}
												<span className="text-[var(--text-quaternary)]">
													· {formatRelativeTime(comment.createdAt)}
												</span>
											</div>
											<p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-[1.5] text-[var(--text-secondary)]">
												{comment.body}
											</p>
										</div>
									</div>
								))}
							</div>
						</>
					)}
				</div>

				<div className="flex w-[200px] shrink-0 flex-col gap-4 border-l border-[rgba(255,255,255,0.04)] p-4">
					<div>
						<div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.3px] text-[var(--text-quaternary)]">
							Status
						</div>
						<select
							value=""
							onChange={(e) => {
								if (e.target.value) handleStatusChange(e.target.value);
							}}
							className="w-full rounded-[5px] border border-[rgba(255,255,255,0.04)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)]"
						>
							<option value="">{issue.status.name}</option>
							{states?.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</select>
					</div>

					<div>
						<div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.3px] text-[var(--text-quaternary)]">
							Workspaces
						</div>
						{linked && linked.length > 0 ? (
							<div className="flex flex-col gap-1">
								{linked.map((ws) => (
									<button
										key={ws.workspaceId}
										type="button"
										onClick={() => onNavigateToWorkspace(ws)}
										className="truncate rounded-[4px] px-2 py-1 text-left text-[11px] text-[var(--accent)] transition-colors hover:bg-[var(--bg-elevated)]"
									>
										{ws.workspaceName ?? ws.workspaceId}
									</button>
								))}
							</div>
						) : (
							<div className="text-[11px] italic text-[var(--text-quaternary)]">None yet</div>
						)}
					</div>

					<div>
						<div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.3px] text-[var(--text-quaternary)]">
							Provider
						</div>
						<div className="text-[11px] text-[var(--text-secondary)]">
							{providerLabel} · {projectLabel}
						</div>
					</div>

					<div className="mt-auto">
						<button
							type="button"
							onClick={onCreateBranch}
							className="w-full rounded-[6px] bg-[var(--accent)] px-3 py-1.5 text-center text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
						>
							Create Worktree
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
