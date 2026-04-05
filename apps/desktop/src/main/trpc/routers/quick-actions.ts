import { eq, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../../db";
import { quickActions } from "../../db/schema";
import { publicProcedure, router } from "../index";

export const quickActionsRouter = router({
	list: publicProcedure
		.input(z.object({ projectId: z.string().nullable() }))
		.query(({ input }) => {
			const db = getDb();
			if (input.projectId) {
				return db
					.select()
					.from(quickActions)
					.where(or(eq(quickActions.projectId, input.projectId), isNull(quickActions.projectId)))
					.orderBy(quickActions.sortOrder)
					.all();
			}
			return db
				.select()
				.from(quickActions)
				.where(isNull(quickActions.projectId))
				.orderBy(quickActions.sortOrder)
				.all();
		}),

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
			const maxOrder =
				input.sortOrder ??
				(() => {
					const rows = input.projectId
						? db
								.select()
								.from(quickActions)
								.where(
									or(
										eq(quickActions.projectId, input.projectId),
										isNull(quickActions.projectId),
									),
								)
								.all()
						: db.select().from(quickActions).where(isNull(quickActions.projectId)).all();
					return rows.length;
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
					sortOrder: maxOrder,
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
			const { id, ...fields } = input;
			db.update(quickActions)
				.set({ ...fields, updatedAt: new Date() })
				.where(eq(quickActions.id, id))
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
			for (let i = 0; i < input.orderedIds.length; i++) {
				db.update(quickActions)
					.set({ sortOrder: i, updatedAt: new Date() })
					.where(eq(quickActions.id, input.orderedIds[i]!))
					.run();
			}
		}),
});
