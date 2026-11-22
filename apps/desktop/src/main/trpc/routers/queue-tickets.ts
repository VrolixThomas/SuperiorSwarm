import { z } from "zod";
import { getActivityQueueService } from "../../activity-queue/service";
import { readTicketQueueDetail } from "../../activity-queue/ticket-detail";
import {
	getTicketQueueSettings,
	prepareTicketQueueAction,
	refreshTicketQueue,
	setTicketQueueSettings,
} from "../../activity-queue/ticket-runtime";
import { ticketSnapshotFact } from "../../activity-queue/ticket-source";
import { publicProcedure } from "../index";

export const queueTicketProcedures = {
	ticketDetail: publicProcedure
		.input(
			z.object({
				sourceId: z.string(),
				provider: z.enum(["linear", "jira"]),
				accountId: z.string(),
				siteId: z.string(),
				ticketId: z.string(),
			})
		)
		.query(({ input }) => readTicketQueueDetail(input)),

	ticketSettings: publicProcedure.query(() => getTicketQueueSettings()),
	ticketSetSettings: publicProcedure
		.input(z.object({ showAll: z.boolean(), defaultAgent: z.enum(["claude", "codex"]) }))
		.mutation(async ({ input }) => {
			setTicketQueueSettings(input);
			await refreshTicketQueue();
			return getTicketQueueSettings();
		}),
	ticketPrepare: publicProcedure
		.input(
			z.object({
				id: z.string(),
				revision: z.number().int().positive(),
				action: z.enum(["open", "start"]),
			})
		)
		.mutation(async ({ input }) => {
			// Start rechecks provider eligibility; a failed refresh leaves stale state and cannot start.
			if (input.action === "start") await refreshTicketQueue();
			const result = prepareTicketQueueAction(input);
			const fact = ticketSnapshotFact(getActivityQueueService().read(input.id)?.snapshot);
			if (!fact) throw new Error("Ticket details are unavailable. Refresh the queue.");
			const url = new URL(result.target.url);
			if (url.protocol !== "https:" || url.username || url.password)
				throw new Error("Ticket link is unavailable.");
			return { ...result, issue: fact };
		}),
};
