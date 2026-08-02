import { useCallback, useMemo } from "react";
import type {
	AssigneeFilterValue,
	MergedTicketIssue,
	NormalizedStatusCategory,
} from "../../shared/tickets";
import {
	deserializeAssigneeFilter,
	matchesTicketPlanningContext,
	matchesTicketScope,
	normalizeStatusCategory,
} from "../../shared/tickets";
import type { LinkedWorkspace } from "../components/WorkspacePopover";
import { useTabStore } from "../stores/tab-store";
import { useTicketRefreshStore } from "../stores/ticket-refresh-store";
import { trpc } from "../trpc/client";

export interface StatusColumn {
	id: string;
	category: NormalizedStatusCategory;
	label: string;
	color: string;
	items: MergedTicketIssue[];
	jiraStatusIds?: string[];
}

const STATUS_ORDER: NormalizedStatusCategory[] = ["backlog", "todo", "in_progress", "done"];

const STATUS_META: Record<NormalizedStatusCategory, { label: string; color: string }> = {
	backlog: { label: "Backlog", color: "#6e6e73" },
	todo: { label: "Todo", color: "#42526E" },
	in_progress: { label: "In Progress", color: "#0052CC" },
	done: { label: "Done", color: "#00875A" },
};

export function useTicketsData() {
	const activeTicketProject = useTabStore((s) => s.activeTicketProject);
	const activeTicketScope = useTabStore((s) => s.activeTicketScope);
	const refreshError = useTicketRefreshStore((state) => state.refreshError);
	const isRefreshing = useTicketRefreshStore((state) => state.isRefreshing);

	// ── Connection status ────────────────────────────────────────────────────
	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});

	const hasJira = atlassianStatus?.jira.connected;
	const hasLinear = linearStatus?.connected;

	// ── Team members ────────────────────────────────────────────────────────
	const teamMembersScope = useMemo(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return undefined;
		return { provider: activeTicketProject.provider, teamId: activeTicketProject.id };
	}, [activeTicketProject]);

	const { data: teamMembersRaw } = trpc.tickets.getTeamMembers.useQuery(teamMembersScope, {
		staleTime: 60_000,
	});

	const teamMembers = useMemo(() => {
		if (!teamMembersRaw) return [];
		return teamMembersRaw.map((m) => ({
			id: m.userId,
			provider: m.provider,
			name: m.name,
			email: m.email ?? undefined,
			avatarUrl: m.avatarUrl ?? undefined,
		}));
	}, [teamMembersRaw]);

	const currentLinearUserId =
		linearStatus?.connected === true ? (linearStatus.accountId ?? null) : null;

	const currentJiraUserId =
		atlassianStatus?.jira.connected === true ? (atlassianStatus.jira.accountId ?? null) : null;

	// ── Cache-first loading ──────────────────────────────────────────────────
	const { data: cached, isLoading: cacheLoading } = trpc.tickets.getCachedTickets.useQuery(
		undefined,
		{ staleTime: 5_000 }
	);

	const effectiveJiraIssues = cached?.jiraIssues;
	const effectiveLinearIssues = cached?.linearIssues;
	const { data: planningData } = trpc.tickets.getPlanningData.useQuery(undefined, {
		staleTime: 5_000,
	});
	const { data: visibleTeams } = trpc.tickets.getVisibleTeams.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const { data: knownTeams } = trpc.tickets.getAllTeams.useQuery(undefined, {
		staleTime: 30_000,
	});

	const retryRefresh = useCallback(() => {
		window.dispatchEvent(new Event("tickets:refresh-now"));
	}, []);

	// ── Last fetched timestamp ───────────────────────────────────────────────
	const { data: lastFetched } = trpc.tickets.getLastFetched.useQuery(undefined, {
		staleTime: 10_000,
		refetchInterval: 10_000,
	});

	// ── Assignee filter ──────────────────────────────────────────────────────
	const projectId = useMemo(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return "all";
		return `${activeTicketProject.provider}:${activeTicketProject.id}`;
	}, [activeTicketProject]);

	const { data: savedFilter } = trpc.tickets.getAssigneeFilter.useQuery(
		{ projectId },
		{ staleTime: Number.POSITIVE_INFINITY }
	);

	const assigneeFilter: AssigneeFilterValue = useMemo(() => {
		return deserializeAssigneeFilter(savedFilter ?? null);
	}, [savedFilter]);

	// ── Linked workspaces ────────────────────────────────────────────────────
	const { data: linkedTickets } = trpc.tickets.getLinkedTickets.useQuery(undefined, {
		staleTime: 30_000,
	});

	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedTickets) return map;
		for (const l of linkedTickets) {
			if (l.worktreePath === null) continue;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const key = `${l.provider}:${l.ticketId}`;
			const existing = map.get(key);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(key, [entry]);
			}
		}
		return map;
	}, [linkedTickets]);

	// ── Merge and filter ─────────────────────────────────────────────────────
	const allIssues = useMemo(() => {
		const merged: MergedTicketIssue[] = [];

		if (effectiveJiraIssues && hasJira !== false) {
			for (const issue of effectiveJiraIssues) {
				merged.push({
					provider: "jira",
					id: issue.key,
					identifier: issue.key,
					title: issue.summary,
					url: issue.webUrl,
					status: {
						id: issue.statusId ?? issue.status,
						name: issue.status,
						color: issue.statusColor,
					},
					groupId: issue.projectKey,
					projectKey: issue.projectKey,
					updatedAt: issue.updatedAt,
					statusCategory: issue.statusCategory,
					assigneeId: issue.assigneeId ?? null,
					assigneeName: issue.assigneeName ?? null,
					assigneeAvatar: issue.assigneeAvatar ?? null,
					planning: issue.planning,
				});
			}
		}

		if (effectiveLinearIssues && hasLinear !== false) {
			for (const issue of effectiveLinearIssues) {
				merged.push({
					provider: "linear",
					id: issue.id,
					identifier: issue.identifier,
					title: issue.title,
					url: issue.url,
					status: {
						id: issue.stateId,
						name: issue.stateName,
						color: issue.stateColor,
					},
					groupId: issue.teamId,
					stateType: issue.stateType,
					teamName: issue.teamName,
					updatedAt: issue.updatedAt,
					assigneeId: issue.assigneeId ?? null,
					assigneeName: issue.assigneeName ?? null,
					assigneeAvatar: issue.assigneeAvatar ?? null,
					planning: issue.planning,
				});
			}
		}

		return merged;
	}, [effectiveJiraIssues, effectiveLinearIssues, hasJira, hasLinear]);

	const selectedPlanningContext = useMemo(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return undefined;
		return planningData?.contexts.find(
			(candidate) =>
				candidate.provider === activeTicketProject.provider &&
				candidate.groupId === activeTicketProject.id &&
				candidate.selected
		);
	}, [activeTicketProject, planningData]);

	const filteredIssues = useMemo(() => {
		let issues = allIssues;
		if (visibleTeams) {
			const visibleKeys = new Set(visibleTeams.map((team) => `${team.provider}:${team.id}`));
			issues = issues.filter((issue) => visibleKeys.has(`${issue.provider}:${issue.groupId}`));
		}

		// Project filter
		if (activeTicketProject !== "all" && activeTicketProject !== null) {
			issues = issues.filter(
				(issue) =>
					issue.provider === activeTicketProject.provider &&
					issue.groupId === activeTicketProject.id
			);
		}

		issues = issues.filter((issue) => matchesTicketPlanningContext(issue, selectedPlanningContext));

		// Planning scope (current sprint/cycle, backlog, all open, or a selected iteration)
		issues = issues.filter((issue) => {
			const context = planningData?.contexts.find(
				(candidate) =>
					candidate.provider === issue.provider &&
					candidate.groupId === issue.groupId &&
					candidate.selected
			);
			return matchesTicketScope(
				issue,
				activeTicketScope,
				context?.supportsIterations ?? issue.planning !== undefined
			);
		});

		// Assignee filter
		if (assigneeFilter === "me") {
			issues = issues.filter((issue) => {
				const uid = issue.provider === "linear" ? currentLinearUserId : currentJiraUserId;
				return uid !== null && issue.assigneeId === uid;
			});
		} else if (assigneeFilter !== "all" && typeof assigneeFilter === "object") {
			issues = issues.filter((issue) => {
				if (issue.assigneeId === null || issue.assigneeId === undefined)
					return assigneeFilter.includeUnassigned;
				return assigneeFilter.userIds.includes(issue.assigneeId);
			});
		}

		return issues;
	}, [
		allIssues,
		visibleTeams,
		activeTicketProject,
		activeTicketScope,
		planningData,
		selectedPlanningContext,
		assigneeFilter,
		currentLinearUserId,
		currentJiraUserId,
	]);

	const columns = useMemo(() => {
		if (
			selectedPlanningContext?.provider === "jira" &&
			selectedPlanningContext.columns &&
			selectedPlanningContext.columns.length > 0
		) {
			return selectedPlanningContext.columns.map((column, index, boardColumns) => {
				const items = filteredIssues.filter((issue) => column.statusIds.includes(issue.status.id));
				const mappedCategories = new Set(items.map((issue) => issue.statusCategory));
				let category: NormalizedStatusCategory;
				if (mappedCategories.has("done") || index === boardColumns.length - 1) {
					category = "done";
				} else if (mappedCategories.has("indeterminate")) {
					category = "in_progress";
				} else if (mappedCategories.has("new")) {
					category = "todo";
				} else if (/backlog/i.test(column.name)) {
					category = "backlog";
				} else if (/blocked|to\s*do|open/i.test(column.name)) {
					category = "todo";
				} else {
					category = "in_progress";
				}
				return {
					id: `jira:${selectedPlanningContext.id}:${column.id}`,
					category,
					label: column.name,
					color: STATUS_META[category].color,
					items,
					jiraStatusIds: column.statusIds,
				};
			});
		}

		const byCategory = new Map<NormalizedStatusCategory, MergedTicketIssue[]>();
		for (const cat of STATUS_ORDER) {
			byCategory.set(cat, []);
		}
		for (const issue of filteredIssues) {
			const cat = normalizeStatusCategory(issue.provider, issue.statusCategory, issue.stateType);
			byCategory.get(cat)?.push(issue);
		}
		return STATUS_ORDER.map((cat) => ({
			id: cat,
			category: cat,
			...STATUS_META[cat],
			items: byCategory.get(cat) ?? [],
		}));
	}, [filteredIssues, selectedPlanningContext]);

	const isLoading =
		!atlassianStatus ||
		!linearStatus ||
		(cacheLoading && !effectiveJiraIssues && !effectiveLinearIssues);
	const isEmpty = hasJira === false && hasLinear === false;

	return {
		columns,
		filteredIssues,
		allIssues,
		linkedMap,
		isLoading,
		isEmpty,
		refreshError,
		retryRefresh,
		isRefreshing,
		activeTicketProject,
		activeTicketScope,
		planningContexts: planningData?.contexts ?? [],
		iterations: planningData?.iterations ?? [],
		knownTeams: knownTeams ?? [],
		lastFetched: lastFetched ?? cached?.lastFetched ?? null,
		teamMembers,
		assigneeFilter,
		currentLinearUserId,
		currentJiraUserId,
		projectId,
	};
}
