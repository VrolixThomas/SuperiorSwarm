import { useEffect, useMemo, useRef } from "react";
import type {
	AssigneeFilterValue,
	MergedTicketIssue,
	NormalizedStatusCategory,
} from "../../shared/tickets";
import { deserializeAssigneeFilter, normalizeStatusCategory } from "../../shared/tickets";
import type { LinkedWorkspace } from "../components/WorkspacePopover";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export interface StatusColumn {
	category: NormalizedStatusCategory;
	label: string;
	color: string;
	items: MergedTicketIssue[];
}

const STATUS_ORDER: NormalizedStatusCategory[] = ["backlog", "todo", "in_progress", "done"];

const STATUS_META: Record<NormalizedStatusCategory, { label: string; color: string }> = {
	backlog: { label: "Backlog", color: "#6e6e73" },
	todo: { label: "Todo", color: "#42526E" },
	in_progress: { label: "In Progress", color: "#0052CC" },
	done: { label: "Done", color: "#00875A" },
};

const REFRESH_INTERVAL_MS = 30_000;

export function useTicketsData() {
	const activeTicketProject = useTabStore((s) => s.activeTicketProject);
	const utils = trpc.useUtils();

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

	const currentLinearUserId = linearStatus?.connected === true
		? (linearStatus.accountId ?? null)
		: null;

	const currentJiraUserId = atlassianStatus?.jira.connected === true
		? (atlassianStatus.jira.accountId ?? null)
		: null;

	// ── Cache-first loading ──────────────────────────────────────────────────
	const { data: cached, isLoading: cacheLoading } = trpc.tickets.getCachedTickets.useQuery(
		undefined,
		{ staleTime: 5_000 }
	);

	const effectiveJiraIssues = cached?.jiraIssues;
	const effectiveLinearIssues = cached?.linearIssues;

	// ── Background refresh ───────────────────────────────────────────────────
	const refreshMutation = trpc.tickets.refreshTickets.useMutation({
		onSuccess: () => {
			utils.tickets.getCachedTickets.invalidate();
			utils.tickets.getLastFetched.invalidate();
		},
	});
	const refreshRef = useRef(refreshMutation.mutateAsync);
	refreshRef.current = refreshMutation.mutateAsync;

	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let consecutiveFailures = 0;

		async function tick() {
			if (cancelled) return;
			try {
				const result = await refreshRef.current();
				consecutiveFailures = result?.ok ? 0 : consecutiveFailures + 1;
			} catch {
				consecutiveFailures += 1;
			}
			if (cancelled) return;
			const delay = Math.min(REFRESH_INTERVAL_MS * 2 ** consecutiveFailures, 5 * 60_000);
			timer = setTimeout(tick, delay);
		}

		tick();

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
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

		if (effectiveJiraIssues) {
			for (const issue of effectiveJiraIssues) {
				merged.push({
					provider: "jira",
					id: issue.key,
					identifier: issue.key,
					title: issue.summary,
					url: issue.webUrl,
					status: {
						id: issue.status,
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
				});
			}
		}

		if (effectiveLinearIssues) {
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
					assigneeId: issue.assigneeId ?? null,
					assigneeName: issue.assigneeName ?? null,
					assigneeAvatar: issue.assigneeAvatar ?? null,
				});
			}
		}

		return merged;
	}, [effectiveJiraIssues, effectiveLinearIssues]);

	const filteredIssues = useMemo(() => {
		let issues = allIssues;

		// Project filter
		if (activeTicketProject !== "all" && activeTicketProject !== null) {
			issues = issues.filter(
				(issue) =>
					issue.provider === activeTicketProject.provider &&
					issue.groupId === activeTicketProject.id
			);
		}

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
	}, [allIssues, activeTicketProject, assigneeFilter, currentLinearUserId, currentJiraUserId]);

	const columns = useMemo(() => {
		const byCategory = new Map<NormalizedStatusCategory, MergedTicketIssue[]>();
		for (const cat of STATUS_ORDER) {
			byCategory.set(cat, []);
		}
		for (const issue of filteredIssues) {
			const cat = normalizeStatusCategory(issue.provider, issue.statusCategory, issue.stateType);
			byCategory.get(cat)?.push(issue);
		}
		return STATUS_ORDER.map((cat) => ({
			category: cat,
			...STATUS_META[cat],
			items: byCategory.get(cat) ?? [],
		}));
	}, [filteredIssues]);

	const isLoading = cacheLoading && !effectiveJiraIssues && !effectiveLinearIssues;
	const isEmpty = !hasJira && !hasLinear;

	return {
		columns,
		filteredIssues,
		allIssues,
		linkedMap,
		isLoading,
		isEmpty,
		activeTicketProject,
		lastFetched: lastFetched ?? cached?.lastFetched ?? null,
		teamMembers,
		assigneeFilter,
		currentLinearUserId,
		currentJiraUserId,
		projectId,
	};
}
