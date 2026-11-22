import { eq } from "drizzle-orm";
import type { ActivityQueueItem, ExternalQueueItem } from "../../shared/activity-queue";
import {
	type TicketQueueAccount,
	type TicketQueueComment,
	type TicketQueueFact,
	type TicketQueueLink,
	ticketAccountKey,
	ticketQueueSourceId,
} from "../../shared/ticket-queue";
import { getDb } from "../db";
import { workspaces } from "../db/schema";
import type { ActivityQueueService } from "./service";

interface TicketSnapshot {
	version: 1;
	account: TicketQueueAccount;
	fact: TicketQueueFact;
	eligible: boolean;
	intake: boolean;
	fresh: boolean;
	feedbackBaseline: boolean;
	seenComments: string[];
	pendingComments: TicketQueueComment[];
	link?: TicketQueueLink;
}
function readSnapshot(value: unknown): TicketSnapshot | null {
	if (!value || typeof value !== "object") return null;
	const snapshot = value as TicketSnapshot;
	return snapshot.version === 1 &&
		snapshot.account &&
		["linear", "jira"].includes(snapshot.account.provider) &&
		typeof snapshot.account.accountId === "string" &&
		typeof snapshot.account.siteId === "string" &&
		snapshot.fact &&
		typeof snapshot.fact.id === "string" &&
		typeof snapshot.eligible === "boolean" &&
		typeof snapshot.intake === "boolean" &&
		typeof snapshot.fresh === "boolean" &&
		typeof snapshot.feedbackBaseline === "boolean" &&
		Array.isArray(snapshot.seenComments) &&
		snapshot.seenComments.every((id) => typeof id === "string") &&
		Array.isArray(snapshot.pendingComments) &&
		snapshot.pendingComments.every(
			(comment) =>
				comment &&
				typeof comment.id === "string" &&
				typeof comment.body === "string" &&
				typeof comment.author === "string" &&
				Number.isFinite(comment.createdAt) &&
				(comment.authorId === null || typeof comment.authorId === "string")
		)
		? snapshot
		: null;
}

/** Only call after a complete, identity-checked account issue snapshot. */
export function observeTicketPoll(
	input: {
		account: TicketQueueAccount;
		facts: TicketQueueFact[];
		links: Map<string, TicketQueueLink>;
		showAll: boolean;
		observedAt: number;
	},
	queue: ActivityQueueService
): void {
	const { account, facts, links, showAll, observedAt } = input;
	const accountSource = `ticket-account:${ticketAccountKey(account)}`;
	const baseline = queue.read(accountSource);
	if (baseline && baseline.observedAt > observedAt) return;
	const ids = facts.map((fact) => ticketQueueSourceId(account, fact.id));
	const previousIds = (baseline?.snapshot as { ids?: string[] } | undefined)?.ids ?? [];
	for (const fact of facts) {
		const sourceId = ticketQueueSourceId(account, fact.id);
		const previous = readSnapshot(queue.read(sourceId)?.snapshot);
		const link = links.get(fact.id);
		const owned = fact.assigneeId === account.accountId;
		const eligible = owned && fact.state === "unstarted" && !link;
		const fresh = eligible && Boolean(baseline && (!previous?.eligible || previous.fresh));
		const intake = eligible && (showAll || fresh);
		const feedbackEligible =
			owned && fact.state !== "closed" && (fact.state === "started" || !!link);
		let seen = previous?.seenComments ?? [];
		let pending = previous?.pendingComments ?? [];
		let feedbackBaseline = previous?.feedbackBaseline ?? false;
		if (!feedbackEligible) {
			pending = [];
			feedbackBaseline = false;
		} else if (fact.comments) {
			// Edits enrich the existing occurrence; only new attributable comment IDs create one.
			const currentComments = new Map(fact.comments.map((comment) => [comment.id, comment]));
			pending = pending.map((comment) => currentComments.get(comment.id) ?? comment);
			const unseen = fact.comments.filter((comment) => !seen.includes(comment.id));
			if (feedbackBaseline) {
				pending = [
					...pending,
					...unseen.filter((comment) => comment.authorId && comment.authorId !== account.accountId),
				];
			}
			const latestSelf = Math.max(
				0,
				...fact.comments
					.filter((comment) => comment.authorId === account.accountId)
					.map((comment) => comment.createdAt)
			);
			pending = [
				...new Map(
					pending
						.filter(
							(comment) =>
								comment.authorId &&
								comment.authorId !== account.accountId &&
								comment.createdAt >= latestSelf
						)
						.map((comment) => [comment.id, comment])
				).values(),
			].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
			seen = [...new Set([...seen, ...fact.comments.map((comment) => comment.id)])];
			feedbackBaseline = true;
		}
		const snapshot: TicketSnapshot = {
			version: 1,
			account,
			fact,
			eligible,
			intake,
			fresh,
			feedbackBaseline,
			seenComments: seen,
			pendingComments: pending,
			link,
		};
		const kind = intake ? "ticket-start" : pending.length ? "ticket-feedback" : null;
		const feedback = pending.at(-1);
		const summary = intake
			? "Assigned to you and ready to start"
			: `${feedback?.author ?? "A teammate"} commented: ${feedback?.body || "Open the ticket to read the comment."}`;
		queue.observe({
			sourceId,
			sourceType: "ticket",
			snapshot,
			observedAt,
			fingerprint: JSON.stringify({
				eligible,
				intake,
				fresh,
				assignee: fact.assigneeId,
				feedback: pending.map((comment) => comment.id).sort(),
			}),
			candidate: kind
				? {
						kind,
						title: `${fact.identifier} · ${fact.title}`,
						summary,
						projectId: link?.projectId,
						projectName: link?.projectName ?? fact.groupName,
						occurredAt: feedback?.createdAt ?? observedAt,
						reasons: [{ code: kind, label: summary }],
						target: {
							type: "ticket",
							...account,
							ticketId: fact.id,
							identifier: fact.identifier,
							url: fact.url,
							groupId: fact.groupId,
							workspaceId: link?.workspaceId,
						},
					}
				: null,
		});
		if (feedbackEligible && fact.commentsError) queue.markUnavailable(sourceId, fact.commentsError);
	}
	for (const id of previousIds)
		if (!ids.includes(id)) {
			const source = queue.read(id);
			const snapshot = readSnapshot(source?.snapshot);
			if (source && snapshot)
				queue.observe({
					...source,
					observedAt,
					candidate: null,
					fingerprint: "absent",
					snapshot: {
						...snapshot,
						eligible: false,
						intake: false,
						fresh: false,
						feedbackBaseline: false,
						pendingComments: [],
					},
				});
		}
	queue.observe({
		sourceId: accountSource,
		sourceType: "ticket-account",
		snapshot: { ids },
		observedAt,
		fingerprint: "baseline",
		candidate: null,
	});
}

export function markTicketPollUnavailable(
	account: TicketQueueAccount,
	error: string,
	queue: ActivityQueueService
): void {
	const baseline = queue.read(`ticket-account:${ticketAccountKey(account)}`);
	for (const id of (baseline?.snapshot as { ids?: string[] } | undefined)?.ids ?? [])
		queue.markUnavailable(id, error);
}

export function describeTicketQueueItem(item: ActivityQueueItem): ExternalQueueItem | null {
	if (item.target.type !== "ticket") return null;
	const start = item.kind === "ticket-start";
	const workspace = item.target.workspaceId
		? getDb()
				.select({ id: workspaces.id, name: workspaces.name })
				.from(workspaces)
				.where(eq(workspaces.id, item.target.workspaceId))
				.get()
		: undefined;
	return {
		...item,
		category: "tickets",
		situation: item.kind,
		subject: item.title,
		why: item.summary,
		clearsWhen: start
			? "Clears when you link a workspace, start the ticket, or dismiss this occurrence."
			: "Clears after your later reply is confirmed, ownership ends, or you dismiss this feedback.",
		sourceLabel: item.target.provider === "linear" ? "Linear" : "Jira",
		nextAction: start
			? "Open the ticket or start work in a new workspace."
			: "Read the new comment and reply on the ticket if needed.",
		openLabel: "Open ticket",
		detailLabel: start ? "Ready to start" : "New feedback",
		evidence: [item.summary],
		context: {
			projectId: item.projectId,
			projectName: item.projectName ?? item.target.groupId,
			projectTint: 1,
			workspaceId: workspace?.id,
			workspaceName: workspace?.name,
		},
	};
}

export function ticketSnapshotFact(value: unknown): TicketQueueFact | null {
	return readSnapshot(value)?.fact ?? null;
}
