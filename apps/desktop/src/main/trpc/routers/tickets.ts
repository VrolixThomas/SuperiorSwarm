import { eq } from "drizzle-orm";
import { z } from "zod";
import type { TicketIteration, TicketNavigationTarget, TicketScope } from "../../../shared/tickets";
import { getAuth as getJiraAuth } from "../../atlassian/auth";
import {
	getProjectIssuesWithDone,
	getProjectPlanningSnapshot,
	mergeJiraPlanningIssues,
} from "../../atlassian/jira";
import { getDb } from "../../db";
import { sessionState, ticketBranchLinks, workspaces, worktrees } from "../../db/schema";
import { getAuth as getLinearAuth } from "../../linear/auth";
import { getTeamCycles, getTeamIssuesWithDone } from "../../linear/linear";
import { log } from "../../logger";
import {
	clearProviderTicketData,
	getAssigneeFilter,
	getCachedJiraIssues,
	getCachedLinearIssues,
	getCachedTeamMembers,
	getDefaultTicketNavigation,
	getDoneCutoffDays,
	getKnownTeams,
	getLastFetched,
	getPlanningData,
	getSelectedJiraBoard,
	getVisibleTeamsTyped,
	mergeKnownTeams,
	pruneOrphanTeamMembers,
	pruneOrphanTicketCache,
	replaceProviderPlanning,
	setAssigneeFilter,
	setDefaultTicketNavigation,
	setDoneCutoffDays,
	setLastFetched,
	setSelectedJiraBoard,
	setVisibleTeamsTyped,
	updateCachedAssignee,
	upsertJiraIssues,
	upsertLinearIssues,
	upsertTeamMembers,
} from "../../tickets/cache";
import {
	extractJiraAssignees,
	extractLinearAssignees,
	mergeRefreshedIssuesPreservingFailures,
} from "../../tickets/sync-helpers";
import { publicProcedure, router } from "../index";

const COLLAPSED_GROUPS_KEY = "sidebar_collapsed_groups";
const LINEAR_METADATA_REFRESH_MS = 5 * 60_000;
const linearMetadataFetchedAt = new Map<string, number>();

type VisibleTeams = Array<{ provider: "linear" | "jira"; id: string }> | null;
type TicketFocus = { provider: "linear" | "jira"; id: string };
type ProviderSyncResult = { count: number; ok: boolean; error?: string };

function syncErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

const ticketNavigationSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("all") }),
	z.object({
		kind: z.literal("group"),
		provider: z.enum(["linear", "jira"]),
		groupId: z.string().min(1),
		contextId: z.string().min(1).optional(),
	}),
]);

const ticketScopeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("current") }),
	z.object({ kind: z.literal("backlog") }),
	z.object({ kind: z.literal("all_open") }),
	z.object({
		kind: z.literal("iteration"),
		provider: z.enum(["linear", "jira"]),
		iterationId: z.string(),
	}),
]);

async function syncJira(
	visible: VisibleTeams,
	cutoff: number,
	scope?: TicketScope,
	focus?: TicketFocus
): Promise<ProviderSyncResult> {
	let count = 0;
	try {
		let projectKeys: string[];
		let discoveryError: string | null = null;
		if (visible) {
			projectKeys = visible.filter((v) => v.provider === "jira").map((v) => v.id);
		} else {
			const cachedProjectKeys = getCachedJiraIssues().map((issue) => issue.projectKey);
			try {
				const { getMyIssues } = await import("../../atlassian/jira");
				const myIssues = await getMyIssues(200);
				projectKeys = [
					...new Set([...myIssues.map((issue) => issue.projectKey), ...cachedProjectKeys]),
				];
			} catch (error) {
				discoveryError = syncErrorMessage(error);
				projectKeys = [...new Set(cachedProjectKeys)];
				log.warn("[tickets] Failed to discover assigned Jira projects", error);
			}
		}

		// Refresh the complete project list even when no issue snapshot is returned,
		// so users can explicitly open a project's backlog from the sidebar.
		try {
			const { getProjects } = await import("../../atlassian/jira");
			const projects = await getProjects();
			mergeKnownTeams(
				"jira",
				projects.map((project) => ({
					provider: "jira" as const,
					id: project.key,
					name: project.name,
				}))
			);
		} catch (error) {
			// Keep the previously discovered project list.
			log.warn("[tickets] Failed to refresh Jira projects", error);
		}

		if (
			focus?.provider === "jira" &&
			(!visible || visible.some((team) => team.provider === "jira" && team.id === focus.id)) &&
			!projectKeys.includes(focus.id)
		) {
			projectKeys.push(focus.id);
		}

		if (projectKeys.length === 0) {
			if (visible) clearProviderTicketData("jira");
			return discoveryError
				? { count: getCachedJiraIssues().length, ok: false, error: discoveryError }
				: { count: getCachedJiraIssues().length, ok: true };
		}

		const selectedBoardByProject = Object.fromEntries(
			projectKeys.map((projectKey) => [projectKey, getSelectedJiraBoard(projectKey)])
		);
		const selectedIterationId =
			scope?.kind === "iteration" && scope.provider === "jira" ? scope.iterationId : undefined;
		// Preserve the proven Jira project/JQL sync as the source of truth. Planning
		// requests below only enrich these issues with board and sprint placement.
		const projectIssues = await getProjectIssuesWithDone(projectKeys, cutoff);
		const snapshot = await getProjectPlanningSnapshot(
			projectKeys,
			projectIssues,
			selectedBoardByProject,
			selectedIterationId
		);
		const failedProjectKeys = new Set(snapshot.failures.map((failure) => failure.projectKey));
		const mergedIssues = mergeJiraPlanningIssues([
			mergeRefreshedIssuesPreservingFailures(
				snapshot.issues,
				getCachedJiraIssues(),
				failedProjectKeys,
				(issue) => issue.key,
				(issue) => issue.projectKey
			),
		]);
		upsertJiraIssues(mergedIssues);

		const currentPlanning = getPlanningData();
		const retainedFailedContexts = currentPlanning.contexts.filter(
			(context) => context.provider === "jira" && failedProjectKeys.has(context.groupId)
		);
		const retainedFailedContextGroups = new Set(
			retainedFailedContexts.map((context) => context.groupId)
		);
		replaceProviderPlanning(
			"jira",
			[
				...snapshot.contexts.filter(
					(context) =>
						!failedProjectKeys.has(context.groupId) ||
						!retainedFailedContextGroups.has(context.groupId)
				),
				...retainedFailedContexts,
			],
			[
				...snapshot.iterations,
				...currentPlanning.iterations.filter(
					(iteration) => iteration.provider === "jira" && failedProjectKeys.has(iteration.groupId)
				),
			]
		);
		count = mergedIssues.length;

		const assigneesByProject = new Map(
			extractJiraAssignees(mergedIssues).map(({ projectKey, members }) => [projectKey, members])
		);
		for (const projectKey of projectKeys) {
			if (failedProjectKeys.has(projectKey)) continue;
			upsertTeamMembers("jira", projectKey, assigneesByProject.get(projectKey) ?? []);
		}
		pruneOrphanTeamMembers("jira", projectKeys);
		pruneOrphanTicketCache("jira", projectKeys);

		const errors = [
			discoveryError,
			...snapshot.failures.map((failure) => `${failure.projectKey}: ${failure.message}`),
		].filter((message): message is string => Boolean(message));
		if (errors.length > 0) {
			const error = errors.join(" | ").slice(0, 600);
			log.warn("[tickets] Jira refresh completed with partial failures", error);
			return { count, ok: false, error };
		}
		return { count, ok: true };
	} catch (error) {
		// API failure — cache stays stale, do not prune
		log.error("[tickets] Jira refresh failed; keeping cached tickets", error);
		return { count, ok: false, error: syncErrorMessage(error) };
	}
}

async function syncLinear(
	visible: VisibleTeams,
	cutoff: number,
	scope?: TicketScope,
	focus?: TicketFocus
): Promise<ProviderSyncResult> {
	try {
		const { getTeams, getTeamMembers } = await import("../../linear/linear");
		const allTeams = await getTeams();
		mergeKnownTeams(
			"linear",
			allTeams.map((t) => ({ provider: "linear" as const, id: t.id, name: t.name }))
		);
		const teamIds = visible
			? visible.filter((v) => v.provider === "linear").map((v) => v.id)
			: allTeams.map((team) => team.id);
		if (
			focus?.provider === "linear" &&
			(!visible || visible.some((team) => team.provider === "linear" && team.id === focus.id)) &&
			!teamIds.includes(focus.id)
		) {
			teamIds.push(focus.id);
		}
		if (teamIds.length === 0) {
			clearProviderTicketData("linear");
			return { count: 0, ok: true };
		}

		const selectedCycleId =
			scope?.kind === "iteration" && scope.provider === "linear" ? scope.iterationId : undefined;
		// Issues are fetched in one paginated workspace-wide snapshot, then narrowed locally.
		// Per-team issue crawls multiplied API traffic and made one rate-limited team erase the
		// whole refresh. The optional historical cycle query is also workspace-scoped by cycle ID.
		const teamIdSet = new Set(teamIds);
		const syncedIssues = (await getTeamIssuesWithDone(undefined, cutoff, selectedCycleId)).filter(
			(issue) => teamIdSet.has(issue.teamId)
		);
		upsertLinearIssues(syncedIssues);

		const currentPlanning = getPlanningData();
		const metadataTeamIds = new Set<string>();
		if (focus?.provider === "linear" && teamIdSet.has(focus.id)) metadataTeamIds.add(focus.id);
		if (selectedCycleId) {
			const selectedIteration = currentPlanning.iterations.find(
				(iteration) => iteration.provider === "linear" && iteration.id === selectedCycleId
			);
			if (selectedIteration && teamIdSet.has(selectedIteration.groupId)) {
				metadataTeamIds.add(selectedIteration.groupId);
			}
		}

		const now = Date.now();
		const dueMetadataTeamIds = [...metadataTeamIds].filter(
			(teamId) => now - (linearMetadataFetchedAt.get(teamId) ?? 0) >= LINEAR_METADATA_REFRESH_MS
		);
		const metadataResults = await Promise.all(
			dueMetadataTeamIds.map(async (teamId) => {
				const errors: string[] = [];
				let cycles: Awaited<ReturnType<typeof getTeamCycles>> | null = null;
				let members: Awaited<ReturnType<typeof getTeamMembers>> | null = null;
				try {
					cycles = await getTeamCycles(teamId);
				} catch (error) {
					errors.push(`${teamId} cycles: ${syncErrorMessage(error)}`);
				}
				try {
					members = await getTeamMembers(teamId);
				} catch (error) {
					errors.push(`${teamId} members: ${syncErrorMessage(error)}`);
				}
				// Back off successful and failed metadata requests alike; the issue snapshot remains fresh.
				linearMetadataFetchedAt.set(teamId, now);
				return { teamId, cycles, members, errors };
			})
		);
		const refreshedCyclesByTeam = new Map(
			metadataResults.flatMap((result) =>
				result.cycles ? [[result.teamId, result.cycles] as const] : []
			)
		);

		const issueIterations = new Map<string, TicketIteration>();
		for (const issue of syncedIssues) {
			if (!issue.cycleId || !issue.cycleName || issue.planning.bucket === "backlog") continue;
			issueIterations.set(issue.cycleId, {
				id: issue.cycleId,
				provider: "linear",
				contextId: issue.teamId,
				groupId: issue.teamId,
				name: issue.cycleName,
				state: issue.planning.bucket,
				startAt: null,
				endAt: null,
			});
		}
		const iterationsById = new Map<string, TicketIteration>();
		for (const iteration of currentPlanning.iterations) {
			if (iteration.provider === "linear" && teamIdSet.has(iteration.groupId)) {
				iterationsById.set(iteration.id, iteration);
			}
		}
		for (const [teamId, cycles] of refreshedCyclesByTeam) {
			for (const [iterationId, iteration] of iterationsById) {
				if (iteration.groupId === teamId) iterationsById.delete(iterationId);
			}
			for (const cycle of cycles) {
				iterationsById.set(cycle.id, {
					id: cycle.id,
					provider: "linear",
					contextId: teamId,
					groupId: teamId,
					name: cycle.name,
					state: cycle.state,
					startAt: cycle.startAt,
					endAt: cycle.endAt,
				});
			}
		}
		for (const [iterationId, iteration] of issueIterations) {
			if (!iterationsById.has(iterationId)) iterationsById.set(iterationId, iteration);
		}

		replaceProviderPlanning(
			"linear",
			teamIds.map((teamId) => ({
				id: teamId,
				provider: "linear" as const,
				groupId: teamId,
				name: allTeams.find((team) => team.id === teamId)?.name ?? teamId,
				kind: "team" as const,
				supportsIterations: [...iterationsById.values()].some(
					(iteration) => iteration.groupId === teamId
				),
				selected: true,
			})),
			[...iterationsById.values()]
		);

		const issueAssigneesByTeam = new Map(
			extractLinearAssignees(syncedIssues).map(({ teamId, members }) => [teamId, members])
		);
		const refreshedMembersByTeam = new Map(
			metadataResults.flatMap((result) =>
				result.members ? [[result.teamId, result.members] as const] : []
			)
		);
		for (const teamId of teamIds) {
			const cachedMembers = getCachedTeamMembers({ provider: "linear", teamId });
			const baseMembers = refreshedMembersByTeam.get(teamId)
				? (refreshedMembersByTeam.get(teamId) ?? []).map((member) => ({
						userId: member.id,
						name: member.name,
						email: member.email,
						avatarUrl: member.avatarUrl,
					}))
				: cachedMembers.map((member) => ({
						userId: member.userId,
						name: member.name,
						email: member.email,
						avatarUrl: member.avatarUrl,
					}));
			const memberById = new Map(baseMembers.map((member) => [member.userId, member]));
			for (const assignee of issueAssigneesByTeam.get(teamId) ?? []) {
				if (!memberById.has(assignee.userId)) memberById.set(assignee.userId, assignee);
			}
			upsertTeamMembers("linear", teamId, [...memberById.values()]);
		}
		pruneOrphanTeamMembers("linear", teamIds);
		pruneOrphanTicketCache("linear", teamIds);
		const errors = metadataResults.flatMap((result) => result.errors);
		if (errors.length > 0) {
			const error = errors.join(" | ").slice(0, 600);
			log.warn("[tickets] Linear refresh completed with partial failures", error);
			return { count: syncedIssues.length, ok: false, error };
		}
		return { count: syncedIssues.length, ok: true };
	} catch (error) {
		log.error("[tickets] Linear refresh failed; keeping cached tickets", error);
		return { count: getCachedLinearIssues().length, ok: false, error: syncErrorMessage(error) };
	}
}

async function runRefreshAllTickets(scope?: TicketScope, focus?: TicketFocus) {
	const cutoff = getDoneCutoffDays();
	const visible = getVisibleTeamsTyped();
	const jiraAuth = getJiraAuth("jira");
	const linearAuth = getLinearAuth();

	if (!jiraAuth?.cloudId) clearProviderTicketData("jira");
	if (!linearAuth) clearProviderTicketData("linear");

	const [jiraResult, linearResult] = await Promise.all([
		jiraAuth?.cloudId
			? syncJira(visible, cutoff, scope, focus)
			: Promise.resolve<ProviderSyncResult>({ count: 0, ok: true }),
		linearAuth
			? syncLinear(visible, cutoff, scope, focus)
			: Promise.resolve<ProviderSyncResult>({ count: 0, ok: true }),
	]);
	const results = {
		jiraCount: jiraResult.count,
		linearCount: linearResult.count,
		ok: jiraResult.ok && linearResult.ok,
		errors: {
			jira: jiraResult.error ?? null,
			linear: linearResult.error ?? null,
		},
	};
	if ((jiraAuth?.cloudId || linearAuth) && results.ok) setLastFetched();
	return results;
}

let refreshQueue: Promise<void> = Promise.resolve();

function refreshAllTickets(scope?: TicketScope, focus?: TicketFocus) {
	const result = refreshQueue.then(() => runRefreshAllTickets(scope, focus));
	refreshQueue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}

export const ticketsRouter = router({
	linkTicket: publicProcedure
		.input(
			z.object({
				provider: z.enum(["linear", "jira"]),
				ticketId: z.string(),
				workspaceId: z.string(),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			db.insert(ticketBranchLinks)
				.values({
					id: crypto.randomUUID(),
					workspaceId: input.workspaceId,
					provider: input.provider,
					ticketId: input.ticketId,
					createdAt: new Date(),
				})
				.onConflictDoNothing()
				.run();
		}),

	getLinkedTickets: publicProcedure.query(() => {
		const db = getDb();
		const rows = db
			.select({
				provider: ticketBranchLinks.provider,
				ticketId: ticketBranchLinks.ticketId,
				workspaceId: ticketBranchLinks.workspaceId,
				workspaceName: workspaces.name,
				worktreePath: worktrees.path,
			})
			.from(ticketBranchLinks)
			.leftJoin(workspaces, eq(workspaces.id, ticketBranchLinks.workspaceId))
			.leftJoin(worktrees, eq(worktrees.id, workspaces.worktreeId))
			.all();
		return rows;
	}),

	getCollapsedGroups: publicProcedure.query(() => {
		const db = getDb();
		const row = db
			.select()
			.from(sessionState)
			.where(eq(sessionState.key, COLLAPSED_GROUPS_KEY))
			.get();
		return row?.value ? (JSON.parse(row.value) as string[]) : [];
	}),

	setCollapsedGroups: publicProcedure
		.input(z.object({ groups: z.array(z.string()) }))
		.mutation(({ input }) => {
			const db = getDb();
			db.insert(sessionState)
				.values({ key: COLLAPSED_GROUPS_KEY, value: JSON.stringify(input.groups) })
				.onConflictDoUpdate({
					target: sessionState.key,
					set: { value: JSON.stringify(input.groups) },
				})
				.run();
		}),

	getViewMode: publicProcedure.input(z.object({ projectId: z.string() })).query(({ input }) => {
		const db = getDb();
		const key = `tickets_view_mode_${input.projectId}`;
		const row = db.select().from(sessionState).where(eq(sessionState.key, key)).get();
		return (row?.value as "board" | "list" | "table") ?? "board";
	}),

	setViewMode: publicProcedure
		.input(
			z.object({
				projectId: z.string(),
				mode: z.enum(["board", "list", "table"]),
			})
		)
		.mutation(({ input }) => {
			const db = getDb();
			const key = `tickets_view_mode_${input.projectId}`;
			db.insert(sessionState)
				.values({ key, value: input.mode })
				.onConflictDoUpdate({
					target: sessionState.key,
					set: { value: input.mode },
				})
				.run();
		}),

	getCachedTickets: publicProcedure.query(() => {
		return {
			jiraIssues: getCachedJiraIssues(),
			linearIssues: getCachedLinearIssues(),
			lastFetched: getLastFetched(),
		};
	}),

	refreshTickets: publicProcedure
		.input(
			z
				.object({
					scope: ticketScopeSchema.optional(),
					focus: z.object({ provider: z.enum(["linear", "jira"]), id: z.string() }).optional(),
				})
				.optional()
		)
		.mutation(({ input }) => refreshAllTickets(input?.scope, input?.focus)),

	getLastFetched: publicProcedure.query(() => {
		return getLastFetched();
	}),

	getDoneCutoffDays: publicProcedure.query(() => {
		return getDoneCutoffDays();
	}),

	setDoneCutoffDays: publicProcedure
		.input(z.object({ days: z.number().int().min(1).max(365) }))
		.mutation(({ input }) => {
			setDoneCutoffDays(input.days);
		}),

	getTeamMembers: publicProcedure
		.input(
			z
				.object({
					provider: z.enum(["linear", "jira"]).optional(),
					teamId: z.string().optional(),
				})
				.optional()
		)
		.query(({ input }) => getCachedTeamMembers(input)),

	getAssigneeFilter: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.query(({ input }) => {
			const raw = getAssigneeFilter(input.projectId);
			return raw ?? "me";
		}),

	setAssigneeFilter: publicProcedure
		.input(z.object({ projectId: z.string(), value: z.string() }))
		.mutation(({ input }) => {
			setAssigneeFilter(input.projectId, input.value);
		}),

	getVisibleTeams: publicProcedure.query(() => getVisibleTeamsTyped()),

	getPlanningData: publicProcedure.query(() => getPlanningData()),

	getDefaultNavigation: publicProcedure.query(() => getDefaultTicketNavigation()),

	setDefaultNavigation: publicProcedure
		.input(z.object({ target: ticketNavigationSchema }))
		.mutation(({ input }) => {
			setDefaultTicketNavigation(input.target as TicketNavigationTarget);
			return input.target;
		}),

	// Full team/project list from providers — used by TeamVisibilitySettings so teams with
	// zero issues remain togglable. Falls back to the persisted cache between syncs.
	getAllTeams: publicProcedure.query(() => getKnownTeams()),

	setVisibleTeams: publicProcedure
		.input(
			z.object({
				teams: z
					.array(z.object({ provider: z.enum(["linear", "jira"]), id: z.string() }))
					.nullable(),
			})
		)
		.mutation(async ({ input }) => {
			setVisibleTeamsTyped(input.teams);
			return refreshAllTickets({ kind: "current" });
		}),

	setJiraBoard: publicProcedure
		.input(z.object({ projectKey: z.string(), boardId: z.string() }))
		.mutation(async ({ input }) => {
			setSelectedJiraBoard(input.projectKey, input.boardId);
			return refreshAllTickets({ kind: "current" }, { provider: "jira", id: input.projectKey });
		}),

	reassignTicket: publicProcedure
		.input(
			z.object({
				provider: z.enum(["linear", "jira"]),
				ticketId: z.string(),
				assigneeId: z.string().nullable(),
			})
		)
		.mutation(async ({ input }) => {
			// Defense-in-depth: only reassign tickets the user has already loaded locally.
			// Prevents a compromised renderer from reassigning arbitrary tickets via our OAuth tokens.
			if (input.provider === "linear") {
				const exists = getCachedLinearIssues().some((i) => i.id === input.ticketId);
				if (!exists) throw new Error("Ticket not found in local cache");
				const { updateIssueAssignee } = await import("../../linear/linear");
				await updateIssueAssignee(input.ticketId, input.assigneeId);
			} else {
				const exists = getCachedJiraIssues().some((i) => i.key === input.ticketId);
				if (!exists) throw new Error("Ticket not found in local cache");
				const { updateIssueAssignee } = await import("../../atlassian/jira");
				await updateIssueAssignee(input.ticketId, input.assigneeId);
			}
			updateCachedAssignee(input.provider, input.ticketId, input.assigneeId);
		}),
});
