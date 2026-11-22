import {
	type TicketQueueAccount,
	type TicketQueueComment,
	ticketQueueSourceId,
} from "../../shared/ticket-queue";
import { getIssueDetail as getJiraIssueDetail } from "../atlassian/jira";
import { getIssueDetail as getLinearIssueDetail } from "../linear/linear";
import { getActivityQueueService } from "./service";
import { fetchTicketQueueComments } from "./ticket-fetch";
import { ticketQueueAccountCurrent } from "./ticket-runtime";
import { ticketSnapshotFact } from "./ticket-source";

type Destination = TicketQueueAccount & { sourceId: string; ticketId: string };
export async function readTicketQueueDetail(
	input: Destination,
	reads: {
		description: (input: Destination) => Promise<{ description: string }>;
		comments: (input: Destination) => Promise<TicketQueueComment[]>;
	} = {
		description: (value) =>
			value.provider === "linear"
				? getLinearIssueDetail(value.ticketId)
				: getJiraIssueDetail(value.ticketId),
		comments: (value) => fetchTicketQueueComments(value, value.ticketId),
	}
) {
	const valid = () =>
		ticketQueueAccountCurrent(input) &&
		ticketQueueSourceId(input, input.ticketId) === input.sourceId;
	if (!valid()) throw new Error("The ticket account or site changed. Reopen it from the queue.");
	const fact = ticketSnapshotFact(getActivityQueueService().read(input.sourceId)?.snapshot);
	if (!fact || fact.id !== input.ticketId || fact.provider !== input.provider)
		throw new Error("Ticket details are unavailable. Refresh the queue.");
	try {
		const [detail, comments] = await Promise.all([reads.description(input), reads.comments(input)]);
		if (!valid()) throw new Error("The ticket account or site changed.");
		return { issue: fact, description: detail.description, comments };
	} catch {
		throw new Error(
			"Ticket details could not be loaded for this account. Refresh or reconnect the provider."
		);
	}
}
