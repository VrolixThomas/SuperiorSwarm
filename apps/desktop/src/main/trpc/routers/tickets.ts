import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../../db";
import { sessionState, ticketBranchLinks, workspaces, worktrees } from "../../db/schema";
import { publicProcedure, router } from "../index";

const COLLAPSED_GROUPS_KEY = "sidebar_collapsed_groups";

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
});
