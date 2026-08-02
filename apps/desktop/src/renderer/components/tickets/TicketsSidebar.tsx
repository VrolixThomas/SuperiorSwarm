import { useCallback, useMemo } from "react";
import type { TicketNavigationTarget, TicketTeam } from "../../../shared/tickets";
import { ticketNavigationTargetsEqual } from "../../../shared/tickets";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { ConnectBanner } from "../ConnectBanner";
import { TeamVisibilitySettings } from "./TeamVisibilitySettings";
import { TicketBoardNavigator, type TicketNavigationEntry } from "./TicketBoardNavigator";

export function TicketsSidebar() {
	const activeTicketProject = useTabStore((state) => state.activeTicketProject);
	const setActiveTicketProject = useTabStore((state) => state.setActiveTicketProject);
	const utils = trpc.useUtils();

	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const hasJira = atlassianStatus?.jira.connected;
	const hasLinear = linearStatus?.connected;

	const { data: cached } = trpc.tickets.getCachedTickets.useQuery(undefined, {
		staleTime: 5_000,
	});
	const { data: knownTeams } = trpc.tickets.getAllTeams.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: visibleTeams } = trpc.tickets.getVisibleTeams.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const { data: planningData } = trpc.tickets.getPlanningData.useQuery(undefined, {
		staleTime: 5_000,
	});
	const defaultNavigationQuery = trpc.tickets.getDefaultNavigation.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});

	const setJiraBoard = trpc.tickets.setJiraBoard.useMutation({
		onSuccess: () => {
			utils.tickets.getCachedTickets.invalidate();
			utils.tickets.getPlanningData.invalidate();
			utils.tickets.getTeamMembers.invalidate();
		},
	});
	const setDefaultNavigation = trpc.tickets.setDefaultNavigation.useMutation({
		onMutate: async ({ target }) => {
			await utils.tickets.getDefaultNavigation.cancel();
			const previous = utils.tickets.getDefaultNavigation.getData();
			utils.tickets.getDefaultNavigation.setData(undefined, target);
			return { previous };
		},
		onError: (_error, _input, context) => {
			utils.tickets.getDefaultNavigation.setData(undefined, context?.previous);
		},
		onSettled: () => utils.tickets.getDefaultNavigation.invalidate(),
	});

	const { entries, totalCount, allTeams } = useMemo(() => {
		const visibleSet = visibleTeams
			? new Set(visibleTeams.map((team) => `${team.provider}:${team.id}`))
			: null;
		const teamMap = new Map<string, TicketTeam>();
		for (const team of knownTeams ?? []) {
			if ((team.provider === "jira" && !hasJira) || (team.provider === "linear" && !hasLinear)) {
				continue;
			}
			teamMap.set(`${team.provider}:${team.id}`, team);
		}

		const jiraCounts = new Map<string, number>();
		const linearCounts = new Map<string, number>();
		for (const issue of cached?.jiraIssues ?? []) {
			if (!hasJira) continue;
			jiraCounts.set(issue.projectKey, (jiraCounts.get(issue.projectKey) ?? 0) + 1);
			const key = `jira:${issue.projectKey}`;
			if (!teamMap.has(key)) {
				teamMap.set(key, { id: issue.projectKey, provider: "jira", name: issue.projectKey });
			}
		}
		for (const issue of cached?.linearIssues ?? []) {
			if (!hasLinear) continue;
			linearCounts.set(issue.teamId, (linearCounts.get(issue.teamId) ?? 0) + 1);
			const key = `linear:${issue.teamId}`;
			if (!teamMap.has(key)) {
				teamMap.set(key, { id: issue.teamId, provider: "linear", name: issue.teamName });
			}
		}

		const navigationEntries: TicketNavigationEntry[] = [];
		for (const team of teamMap.values()) {
			if (visibleSet && !visibleSet.has(`${team.provider}:${team.id}`)) continue;
			if (team.provider === "linear") {
				navigationEntries.push({
					target: { kind: "group", provider: "linear", groupId: team.id },
					name: team.name,
					meta: "Linear",
					provider: "linear",
					count: linearCounts.get(team.id) ?? 0,
				});
				continue;
			}

			const boardContexts = (planningData?.contexts ?? []).filter(
				(context) =>
					context.provider === "jira" &&
					context.groupId === team.id &&
					!context.id.startsWith("jira-project:")
			);
			if (boardContexts.length === 0) {
				navigationEntries.push({
					target: { kind: "group", provider: "jira", groupId: team.id },
					name: team.name,
					meta: `Jira · ${team.id}`,
					provider: "jira",
					count: jiraCounts.get(team.id) ?? 0,
				});
				continue;
			}

			for (const board of boardContexts) {
				const boardCount = (cached?.jiraIssues ?? []).filter(
					(issue) => issue.projectKey === team.id && issue.planning?.contextId === board.id
				).length;
				navigationEntries.push({
					target: {
						kind: "group",
						provider: "jira",
						groupId: team.id,
						contextId: board.id,
					},
					name: board.name,
					meta: `Jira · ${team.name}`,
					provider: "jira",
					count: boardCount,
				});
			}
		}

		navigationEntries.sort((left, right) => {
			const leftDefault = ticketNavigationTargetsEqual(left.target, defaultNavigationQuery.data);
			const rightDefault = ticketNavigationTargetsEqual(right.target, defaultNavigationQuery.data);
			if (leftDefault !== rightDefault) return leftDefault ? -1 : 1;
			if (left.count > 0 !== right.count > 0) return left.count > 0 ? -1 : 1;
			return left.name.localeCompare(right.name);
		});

		return {
			entries: navigationEntries,
			totalCount:
				[...jiraCounts.values()].reduce((sum, count) => sum + count, 0) +
				[...linearCounts.values()].reduce((sum, count) => sum + count, 0),
			allTeams: [...teamMap.values()].sort((left, right) => left.name.localeCompare(right.name)),
		};
	}, [
		cached,
		defaultNavigationQuery.data,
		hasJira,
		hasLinear,
		knownTeams,
		planningData,
		visibleTeams,
	]);

	const activeTarget = useMemo<TicketNavigationTarget>(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return { kind: "all" };
		const selectedContext = planningData?.contexts.find(
			(context) =>
				context.provider === activeTicketProject.provider &&
				context.groupId === activeTicketProject.id &&
				context.selected &&
				!context.id.startsWith("jira-project:")
		);
		return {
			kind: "group",
			provider: activeTicketProject.provider,
			groupId: activeTicketProject.id,
			contextId: activeTicketProject.provider === "jira" ? selectedContext?.id : undefined,
		};
	}, [activeTicketProject, planningData]);

	const selectTarget = useCallback(
		(target: TicketNavigationTarget) => {
			if (target.kind === "all") {
				setActiveTicketProject("all");
				return;
			}
			setActiveTicketProject({ id: target.groupId, provider: target.provider });
			if (target.provider === "jira" && target.contextId) {
				setJiraBoard.mutate({ projectKey: target.groupId, boardId: target.contextId });
			}
		},
		[setActiveTicketProject, setJiraBoard]
	);

	if (!atlassianStatus || !linearStatus) {
		return <div className="mx-3 my-2 h-3 animate-pulse rounded bg-[var(--bg-elevated)]" />;
	}

	if (hasJira === false && hasLinear === false) {
		return (
			<div className="px-3 py-2">
				<ConnectBanner message="Connect Jira or Linear to see your tickets." returnTo="tickets" />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-1 px-2 py-1">
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => selectTarget({ kind: "all" })}
					className={`flex flex-1 items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[11px] transition-colors duration-[120ms] ${
						activeTarget.kind === "all"
							? "bg-[rgba(10,132,255,0.08)] font-medium text-[var(--text)]"
							: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
					}`}
				>
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
						<rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
						<rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
						<rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
						<rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3" />
					</svg>
					<span className="flex-1">All tickets</span>
					<span className="text-[10px] tabular-nums text-[var(--text-quaternary)]">
						{totalCount}
					</span>
				</button>
				<TeamVisibilitySettings teams={allTeams} />
			</div>

			<div className="mx-2 my-1 h-px bg-[var(--border-subtle)]" />

			<TicketBoardNavigator
				entries={entries}
				activeTarget={activeTarget}
				defaultTarget={defaultNavigationQuery.data ?? null}
				onSelect={selectTarget}
				onSetDefault={(target) => setDefaultNavigation.mutate({ target })}
			/>
		</div>
	);
}
