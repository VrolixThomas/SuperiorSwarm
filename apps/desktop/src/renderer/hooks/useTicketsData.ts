import { useEffect, useMemo, useRef } from "react";
import type { MergedTicketIssue, NormalizedStatusCategory } from "../../shared/tickets";
import { normalizeStatusCategory } from "../../shared/tickets";
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

	// ── Cache-first loading ──────────────────────────────────────────────────
	const { data: cached, isLoading: cacheLoading } = trpc.tickets.getCachedTickets.useQuery(
		undefined,
		{ staleTime: 5_000 }
	);

	// Also keep the direct API queries for backward compat with sidebar
	const { data: jiraIssues } = trpc.atlassian.getMyIssues.useQuery(undefined, {
		enabled: hasJira,
		staleTime: 30_000,
	});
	const { data: linearIssues } = trpc.linear.getAssignedIssues.useQuery(undefined, {
		enabled: hasLinear,
		staleTime: 30_000,
	});

	// Prefer API data when available, fall back to cache
	const effectiveJiraIssues = jiraIssues ?? cached?.jiraIssues;
	const effectiveLinearIssues = linearIssues ?? cached?.linearIssues;

	// ── Background refresh ───────────────────────────────────────────────────
	const refreshMutation = trpc.tickets.refreshTickets.useMutation({
		onSuccess: () => {
			utils.tickets.getCachedTickets.invalidate();
			utils.tickets.getLastFetched.invalidate();
		},
	});
	const refreshRef = useRef(refreshMutation.mutate);
	refreshRef.current = refreshMutation.mutate;

	useEffect(() => {
		// Trigger initial refresh
		refreshRef.current();

		// Set up interval
		const interval = setInterval(() => {
			refreshRef.current();
		}, REFRESH_INTERVAL_MS);

		return () => clearInterval(interval);
	}, []);

	// ── Last fetched timestamp ───────────────────────────────────────────────
	const { data: lastFetched } = trpc.tickets.getLastFetched.useQuery(undefined, {
		staleTime: 10_000,
		refetchInterval: 10_000,
	});

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
				});
			}
		}

		return merged;
	}, [effectiveJiraIssues, effectiveLinearIssues]);

	const filteredIssues = useMemo(() => {
		if (activeTicketProject === "all" || activeTicketProject === null) return allIssues;
		return allIssues.filter(
			(issue) =>
				issue.provider === activeTicketProject.provider && issue.groupId === activeTicketProject.id
		);
	}, [allIssues, activeTicketProject]);

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
		linkedMap,
		isLoading,
		isEmpty,
		activeTicketProject,
		lastFetched: lastFetched ?? cached?.lastFetched ?? null,
	};
}
