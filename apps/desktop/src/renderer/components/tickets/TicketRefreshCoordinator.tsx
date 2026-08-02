import { useEffect, useMemo, useRef } from "react";
import type { TicketNavigationTarget } from "../../../shared/tickets";
import { useTabStore } from "../../stores/tab-store";
import { useTicketRefreshStore } from "../../stores/ticket-refresh-store";
import { trpc } from "../../trpc/client";

const REFRESH_INTERVAL_MS = 30_000;

export function TicketRefreshCoordinator() {
	const activeTicketProject = useTabStore((state) => state.activeTicketProject);
	const activeTicketScope = useTabStore((state) => state.activeTicketScope);
	const setActiveTicketProject = useTabStore((state) => state.setActiveTicketProject);
	const setRefreshState = useTicketRefreshStore((state) => state.setRefreshState);
	const utils = trpc.useUtils();

	const { data: atlassianStatus } = trpc.atlassian.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const { data: linearStatus } = trpc.linear.getStatus.useQuery(undefined, {
		staleTime: 30_000,
	});
	const hasJira = atlassianStatus?.jira.connected === true;
	const hasLinear = linearStatus?.connected === true;

	const defaultNavigation = trpc.tickets.getDefaultNavigation.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
	});
	const setJiraBoard = trpc.tickets.setJiraBoard.useMutation({
		onSuccess: () => {
			utils.tickets.getCachedTickets.invalidate();
			utils.tickets.getPlanningData.invalidate();
		},
	});
	const defaultApplied = useRef(false);
	useEffect(() => {
		if (
			defaultApplied.current ||
			defaultNavigation.isLoading ||
			!atlassianStatus ||
			!linearStatus
		) {
			return;
		}
		defaultApplied.current = true;
		const target: TicketNavigationTarget | null = defaultNavigation.data ?? null;
		if (!target) return;
		if (target.kind === "all") {
			setActiveTicketProject("all");
			return;
		}
		setActiveTicketProject({ id: target.groupId, provider: target.provider });
		if (target.provider === "jira" && target.contextId && hasJira) {
			setJiraBoard.mutate({ projectKey: target.groupId, boardId: target.contextId });
		}
	}, [
		atlassianStatus,
		defaultNavigation.data,
		defaultNavigation.isLoading,
		hasJira,
		linearStatus,
		setActiveTicketProject,
		setJiraBoard,
	]);

	const refreshInput = useMemo(
		() => ({
			scope: activeTicketScope,
			focus:
				activeTicketProject === "all" || activeTicketProject === null
					? undefined
					: activeTicketProject,
		}),
		[activeTicketProject, activeTicketScope]
	);
	const refreshMutation = trpc.tickets.refreshTickets.useMutation({
		onMutate: () => {
			const current = useTicketRefreshStore.getState();
			setRefreshState({ refreshError: current.refreshError, isRefreshing: true });
		},
		onSuccess: (result) => {
			utils.tickets.getCachedTickets.invalidate();
			utils.tickets.getLastFetched.invalidate();
			utils.tickets.getPlanningData.invalidate();
			utils.tickets.getTeamMembers.invalidate();
			utils.tickets.getAllTeams.invalidate();
			const messages = [
				result.errors.jira ? `Jira: ${result.errors.jira}` : null,
				result.errors.linear ? `Linear: ${result.errors.linear}` : null,
			].filter((message): message is string => message !== null);
			setRefreshState({
				refreshError: messages.length > 0 ? messages.join(" · ") : null,
				isRefreshing: false,
			});
		},
		onError: (error) => {
			setRefreshState({
				refreshError: error.message || "Ticket refresh failed",
				isRefreshing: false,
			});
		},
	});
	const refreshRef = useRef(refreshMutation.mutateAsync);
	refreshRef.current = refreshMutation.mutateAsync;

	useEffect(() => {
		if (!hasJira && !hasLinear) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let consecutiveFailures = 0;

		async function tick() {
			if (cancelled) return;
			try {
				const result = await refreshRef.current(refreshInput);
				consecutiveFailures = result.ok ? 0 : consecutiveFailures + 1;
			} catch {
				consecutiveFailures += 1;
			}
			if (cancelled) return;
			const delay = Math.min(REFRESH_INTERVAL_MS * 2 ** consecutiveFailures, 5 * 60_000);
			timer = setTimeout(tick, delay);
		}

		void tick();
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [hasJira, hasLinear, refreshInput]);

	useEffect(() => {
		const retry = () => refreshMutation.mutate(refreshInput);
		window.addEventListener("tickets:refresh-now", retry);
		return () => window.removeEventListener("tickets:refresh-now", retry);
	}, [refreshInput, refreshMutation]);

	return null;
}
