import { eq } from "drizzle-orm";
import { z } from "zod";
import { getAuth as getJiraAuth } from "../../atlassian/auth";
import { getProjectIssuesWithDone } from "../../atlassian/jira";
import { getDb } from "../../db";
import { sessionState, ticketBranchLinks, workspaces, worktrees } from "../../db/schema";
import { getAuth as getLinearAuth } from "../../linear/auth";
import { getTeamIssuesWithDone } from "../../linear/linear";
import {
	getAssigneeFilter,
	getCachedJiraIssues,
	getCachedLinearIssues,
	getCachedTeamMembers,
	getDoneCutoffDays,
	getLastFetched,
	getVisibleTeamsTyped,
	pruneOrphanTeamMembers,
	pruneOrphanTicketCache,
	setAssigneeFilter,
	setDoneCutoffDays,
	setLastFetched,
	setVisibleTeamsTyped,
	upsertJiraIssues,
	upsertLinearIssues,
	upsertTeamMembers,
} from "../../tickets/cache";
import { extractJiraAssignees, extractLinearAssignees } from "../../tickets/sync-helpers";
import { publicProcedure, router } from "../index";

const COLLAPSED_GROUPS_KEY = "sidebar_collapsed_groups";

type VisibleTeams = Array<{ provider: "linear" | "jira"; id: string }> | null;

async function syncJira(
	visible: VisibleTeams,
	cutoff: number
): Promise<{ count: number; ok: boolean }> {
	let count = 0;
	let ok = true;
	let projectKeys: string[] = [];
	try {
		if (visible) {
			projectKeys = visible.filter((v) => v.provider === "jira").map((v) => v.id);
		} else {
			const { getMyIssues } = await import("../../atlassian/jira");
			const myIssues = await getMyIssues(200);
			projectKeys = [...new Set(myIssues.map((i) => i.projectKey))];
		}

		if (projectKeys.length > 0) {
			const issues = await getProjectIssuesWithDone(projectKeys, cutoff);
			upsertJiraIssues(issues);
			count = issues.length;
			projectKeys = [...new Set(issues.map((i) => i.projectKey))];

			// Extract assignees while issues is in scope; iterate projectKeys so
			// projects with zero assignees still get an empty upsert (pruning stale members).
			const assigneesByProject = new Map(
				extractJiraAssignees(issues).map(({ projectKey, members }) => [projectKey, members])
			);
			for (const projectKey of projectKeys) {
				upsertTeamMembers("jira", projectKey, assigneesByProject.get(projectKey) ?? []);
			}
		}
	} catch {
		// API failure — cache stays stale
		ok = false;
	}

	if (projectKeys.length > 0) {
		pruneOrphanTeamMembers("jira", projectKeys);
		pruneOrphanTicketCache("jira", projectKeys);
	}

	return { count, ok };
}

async function syncLinear(
	visible: VisibleTeams,
	cutoff: number
): Promise<{ count: number; ok: boolean }> {
	let count = 0;
	let ok = true;
	let teamIds: string[] = [];
	let syncedIssues: import("../../linear/linear").LinearIssue[] = [];
	try {
		const linearTeamIds = visible
			? visible.filter((v) => v.provider === "linear").map((v) => v.id)
			: [];

		if (!visible || linearTeamIds.length > 0) {
			if (linearTeamIds.length > 0) {
				const perTeam = await Promise.all(
					linearTeamIds.map((teamId) => getTeamIssuesWithDone(teamId, cutoff))
				);
				syncedIssues = perTeam.flat();
				upsertLinearIssues(syncedIssues);
				count = syncedIssues.length;
				teamIds = linearTeamIds;
			} else {
				const issues = await getTeamIssuesWithDone(undefined, cutoff);
				syncedIssues = issues;
				upsertLinearIssues(syncedIssues);
				count = syncedIssues.length;
				teamIds = [...new Set(syncedIssues.map((i) => i.teamId))];
			}
		}
	} catch {
		// API failure — cache stays stale
		ok = false;
	}

	try {
		const { getTeams, getTeamMembers } = await import("../../linear/linear");
		const targets = teamIds.length > 0 ? teamIds : (await getTeams()).map((t) => t.id);
		const issueAssigneesByTeam = new Map(
			extractLinearAssignees(syncedIssues).map(({ teamId, members }) => [teamId, members])
		);
		await Promise.all(
			targets.map(async (teamId) => {
				const apiMembers = await getTeamMembers(teamId);
				const apiMemberIds = new Set(apiMembers.map((m) => m.id));
				const issueAssignees = issueAssigneesByTeam.get(teamId) ?? [];
				const merged = [
					...apiMembers.map((m) => ({
						userId: m.id,
						name: m.name,
						email: m.email,
						avatarUrl: m.avatarUrl,
					})),
					...issueAssignees
						.filter((a) => !apiMemberIds.has(a.userId))
						.map((a) => ({ userId: a.userId, name: a.name, email: null, avatarUrl: a.avatarUrl })),
				];
				upsertTeamMembers("linear", teamId, merged);
			})
		);
	} catch {
		// Team members fetch failed — cached data stays
		ok = false;
	}

	if (teamIds.length > 0) {
		pruneOrphanTeamMembers("linear", teamIds);
		pruneOrphanTicketCache("linear", teamIds);
	}

	return { count, ok };
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

	refreshTickets: publicProcedure.mutation(async () => {
		const cutoff = getDoneCutoffDays();
		const visible = getVisibleTeamsTyped();

		const jiraAuth = getJiraAuth("jira");
		const linearAuth = getLinearAuth();

		const [jiraResult, linearResult] = await Promise.all([
			jiraAuth?.cloudId ? syncJira(visible, cutoff) : Promise.resolve({ count: 0, ok: true }),
			linearAuth ? syncLinear(visible, cutoff) : Promise.resolve({ count: 0, ok: true }),
		]);

		const results = {
			jiraCount: jiraResult.count,
			linearCount: linearResult.count,
			ok: jiraResult.ok && linearResult.ok,
		};
		if (results.jiraCount > 0 || results.linearCount > 0) {
			setLastFetched();
		}

		return results;
	}),

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

	setVisibleTeams: publicProcedure
		.input(
			z.object({
				teams: z
					.array(z.object({ provider: z.enum(["linear", "jira"]), id: z.string() }))
					.nullable(),
			})
		)
		.mutation(({ input }) => setVisibleTeamsTyped(input.teams)),

	reassignTicket: publicProcedure
		.input(
			z.object({
				provider: z.enum(["linear", "jira"]),
				ticketId: z.string(),
				assigneeId: z.string().nullable(),
			})
		)
		.mutation(async ({ input }) => {
			if (input.provider === "linear") {
				const { updateIssueAssignee } = await import("../../linear/linear");
				await updateIssueAssignee(input.ticketId, input.assigneeId);
			} else {
				const { updateIssueAssignee } = await import("../../atlassian/jira");
				await updateIssueAssignee(input.ticketId, input.assigneeId);
			}
		}),
});
