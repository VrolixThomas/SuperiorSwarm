import { eq, isNull, max, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { quickActions } from "../../db/schema";
import { launchSetupAgent } from "../../quick-actions/agent-setup";
import { publicProcedure, router } from "../index";

export function listQuickActions(projectId: string | null) {
	const db = getDb();
	if (projectId) {
		return db
			.select()
			.from(quickActions)
			.where(or(eq(quickActions.projectId, projectId), isNull(quickActions.projectId)))
			.orderBy(quickActions.sortOrder)
			.all();
	}
	return db
		.select()
		.from(quickActions)
		.where(isNull(quickActions.projectId))
		.orderBy(quickActions.sortOrder)
		.all();
}

export const quickActionsRouter = router({
	list: publicProcedure
		.input(z.object({ projectId: z.string().nullable() }))
		.query(({ input }) => listQuickActions(input.projectId)),

	create: publicProcedure
		.input(
			z.object({
				projectId: z.string().nullable(),
				label: z.string().min(1),
				command: z.string().min(1),
				cwd: z.string().nullable().optional(),
				shortcut: z.string().nullable().optional(),
				sortOrder: z.number().int().optional(),
			}),
		)
		.mutation(({ input }) => {
			const db = getDb();
			const sortOrder =
				input.sortOrder ??
				(() => {
					const condition = input.projectId
						? or(eq(quickActions.projectId, input.projectId), isNull(quickActions.projectId))
						: isNull(quickActions.projectId);
					const row = db
						.select({ maxOrder: max(quickActions.sortOrder) })
						.from(quickActions)
						.where(condition)
						.get();
					return (row?.maxOrder ?? -1) + 1;
				})();

			const id = nanoid();
			db.insert(quickActions)
				.values({
					id,
					projectId: input.projectId,
					label: input.label,
					command: input.command,
					cwd: input.cwd ?? null,
					shortcut: input.shortcut ?? null,
					sortOrder,
					createdAt: new Date(),
					updatedAt: new Date(),
				})
				.run();

			return { id };
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.string(),
				label: z.string().min(1).optional(),
				command: z.string().min(1).optional(),
				cwd: z.string().nullable().optional(),
				shortcut: z.string().nullable().optional(),
				projectId: z.string().nullable().optional(),
			}),
		)
		.mutation(({ input }) => {
			const db = getDb();
			const updates: Record<string, unknown> = { updatedAt: new Date() };
			if (input.label !== undefined) updates["label"] = input.label;
			if (input.command !== undefined) updates["command"] = input.command;
			if (input.cwd !== undefined) updates["cwd"] = input.cwd;
			if (input.shortcut !== undefined) updates["shortcut"] = input.shortcut;
			if (input.projectId !== undefined) updates["projectId"] = input.projectId;
			db.update(quickActions)
				.set(updates)
				.where(eq(quickActions.id, input.id))
				.run();
		}),

	delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
		const db = getDb();
		db.delete(quickActions).where(eq(quickActions.id, input.id)).run();
	}),

	reorder: publicProcedure
		.input(z.object({ orderedIds: z.array(z.string()) }))
		.mutation(({ input }) => {
			const db = getDb();
			db.transaction(() => {
				for (let i = 0; i < input.orderedIds.length; i++) {
					db.update(quickActions)
						.set({ sortOrder: i, updatedAt: new Date() })
						.where(eq(quickActions.id, input.orderedIds[i]!))
						.run();
				}
			});
		}),

	launchSetupAgent: publicProcedure
		.input(z.object({ projectId: z.string(), repoPath: z.string(), prompt: z.string().optional() }))
		.mutation(({ input }) => {
			return launchSetupAgent(input.projectId, input.repoPath, input.prompt);
		}),
});
