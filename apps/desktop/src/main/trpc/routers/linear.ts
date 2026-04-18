import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { sessionState } from "../../db/schema";
import { deleteAuth, getAuth } from "../../linear/auth";
import {
	getIssueDetail,
	getTeamIssuesWithDone,
	getTeamMembers,
	getTeamStates,
	getTeams,
	updateIssueAssignee,
	updateIssueState,
} from "../../linear/linear";
import { connectLinear } from "../../linear/oauth-flow";
import { publicProcedure, router } from "../index";

const SELECTED_TEAM_KEY = "linear_selected_team_id";

export const linearRouter = router({
	getStatus: publicProcedure.query(() => {
		const auth = getAuth();
		return auth
			? {
					connected: true as const,
					displayName: auth.displayName,
					accountId: auth.accountId,
					email: auth.email,
				}
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

	getTeamIssues: publicProcedure.query(async () => {
		const db = getDb();
		const row = db.select().from(sessionState).where(eq(sessionState.key, SELECTED_TEAM_KEY)).get();
		const { getDoneCutoffDays } = await import("../../tickets/cache");
		return getTeamIssuesWithDone(row?.value ?? undefined, getDoneCutoffDays());
	}),

	// Keep for backward compat during transition
	getAssignedIssues: publicProcedure.query(async () => {
		const db = getDb();
		const row = db.select().from(sessionState).where(eq(sessionState.key, SELECTED_TEAM_KEY)).get();
		const { getDoneCutoffDays } = await import("../../tickets/cache");
		return getTeamIssuesWithDone(row?.value ?? undefined, getDoneCutoffDays());
	}),

	getTeamMembers: publicProcedure
		.input(z.object({ teamId: z.string() }))
		.query(async ({ input }) => {
			return getTeamMembers(input.teamId);
		}),

	updateIssueAssignee: publicProcedure
		.input(z.object({ issueId: z.string(), assigneeId: z.string().nullable() }))
		.mutation(async ({ input }) => {
			return updateIssueAssignee(input.issueId, input.assigneeId);
		}),

	getIssueDetail: publicProcedure
		.input(z.object({ issueId: z.string() }))
		.query(async ({ input }) => {
			return getIssueDetail(input.issueId);
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
});
