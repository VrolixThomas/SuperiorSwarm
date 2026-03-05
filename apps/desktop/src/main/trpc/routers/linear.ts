import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { linearBranchIssues, sessionState, workspaces, worktrees } from "../../db/schema";
import { deleteAuth, getAuth } from "../../linear/auth";
import { getAssignedIssues, getTeamStates, getTeams, updateIssueState } from "../../linear/linear";
import { connectLinear } from "../../linear/oauth-flow";
import { publicProcedure, router } from "../index";

const SELECTED_TEAM_KEY = "linear_selected_team_id";

export const linearRouter = router({
	getStatus: publicProcedure.query(() => {
		const auth = getAuth();
		return auth
			? { connected: true as const, displayName: auth.displayName, accountId: auth.accountId }
			: { connected: false as const };
	}),

	connect: publicProcedure.mutation(async () => {
		await connectLinear();
		const auth = getAuth();
		return auth
			? { connected: true as const, displayName: auth.displayName }
			: { connected: false as const };
	}),

	disconnect: publicProcedure.mutation(() => {
		deleteAuth();
		const db = getDb();
		db.delete(sessionState).where(eq(sessionState.key, SELECTED_TEAM_KEY)).run();
	}),

	getTeams: publicProcedure.query(async () => {
		return getTeams();
	}),

	getSelectedTeam: publicProcedure.query(() => {
		const db = getDb();
		const row = db.select().from(sessionState).where(eq(sessionState.key, SELECTED_TEAM_KEY)).get();
		return row?.value ?? null;
	}),

	setSelectedTeam: publicProcedure
		.input(z.object({ teamId: z.string().nullable() }))
		.mutation(({ input }) => {
			const db = getDb();
			if (input.teamId === null) {
				db.delete(sessionState).where(eq(sessionState.key, SELECTED_TEAM_KEY)).run();
			} else {
				db.insert(sessionState)
					.values({ key: SELECTED_TEAM_KEY, value: input.teamId })
					.onConflictDoUpdate({
						target: sessionState.key,
						set: { value: input.teamId },
					})
					.run();
			}
		}),

	getAssignedIssues: publicProcedure.query(async () => {
		const db = getDb();
		const row = db.select().from(sessionState).where(eq(sessionState.key, SELECTED_TEAM_KEY)).get();
		return getAssignedIssues(row?.value ?? undefined);
	}),

	getTeamStates: publicProcedure
		.input(z.object({ teamId: z.string() }))
		.query(async ({ input }) => {
			return getTeamStates(input.teamId);
		}),

	updateIssueState: publicProcedure
		.input(z.object({ issueId: z.string(), stateId: z.string() }))
		.mutation(async ({ input }) => {
			return updateIssueState(input.issueId, input.stateId);
		}),

	linkIssue: publicProcedure
		.input(z.object({ workspaceId: z.string(), linearIssueId: z.string() }))
		.mutation(({ input }) => {
			const db = getDb();
			db.insert(linearBranchIssues)
				.values({
					id: crypto.randomUUID(),
					workspaceId: input.workspaceId,
					linearIssueId: input.linearIssueId,
					createdAt: new Date(),
				})
				.onConflictDoNothing()
				.run();
		}),

	getLinkedIssues: publicProcedure.query(() => {
		const db = getDb();
		const rows = db
			.select({
				linearIssueId: linearBranchIssues.linearIssueId,
				workspaceId: linearBranchIssues.workspaceId,
				workspaceName: workspaces.name,
				worktreePath: worktrees.path,
			})
			.from(linearBranchIssues)
			.leftJoin(workspaces, eq(workspaces.id, linearBranchIssues.workspaceId))
			.leftJoin(worktrees, eq(worktrees.id, workspaces.worktreeId))
			.all();
		return rows;
	}),
});
