import { eq } from "drizzle-orm";
import type { ActivityQueueItem } from "../../shared/activity-queue";
import {
	type TicketQueueAccount,
	type TicketQueueLink,
	ticketAccountKey,
	ticketQueueSourceId,
} from "../../shared/ticket-queue";
import { getDb } from "../db";
import {
	atlassianAuth,
	linearAuth,
	projects,
	sessionState,
	ticketBranchLinks,
	workspaces,
} from "../db/schema";
import { getActivityQueueService } from "./service";
import { fetchTicketQueueComments, fetchTicketQueueFacts } from "./ticket-fetch";
import { markTicketPollUnavailable, observeTicketPoll } from "./ticket-source";

const SHOW_ALL = "queue_tickets_show_all";
const DEFAULT_AGENT = "queue_tickets_default_agent";
function readSetting(key: string): string | null {
	return getDb().select().from(sessionState).where(eq(sessionState.key, key)).get()?.value ?? null;
}
function writeSetting(key: string, value: string): void {
	getDb()
		.insert(sessionState)
		.values({ key, value })
		.onConflictDoUpdate({ target: sessionState.key, set: { value } })
		.run();
}
export function getTicketQueueSettings() {
	return {
		showAll: readSetting(SHOW_ALL) === "true",
		defaultAgent:
			readSetting(DEFAULT_AGENT) === "claude" ? ("claude" as const) : ("codex" as const),
	};
}
export function setTicketQueueSettings(value: {
	showAll: boolean;
	defaultAgent: "claude" | "codex";
}): void {
	writeSetting(SHOW_ALL, String(value.showAll));
	writeSetting(DEFAULT_AGENT, value.defaultAgent);
}
export function currentTicketQueueAccounts(): (TicketQueueAccount & { siteUrl?: string })[] {
	// Identity-only DB projection: queue listing must never decrypt or expose credentials.
	const db = getDb();
	const linear = db.select({ accountId: linearAuth.accountId }).from(linearAuth).get();
	const jira = db
		.select({
			accountId: atlassianAuth.accountId,
			cloudId: atlassianAuth.cloudId,
			siteUrl: atlassianAuth.siteUrl,
		})
		.from(atlassianAuth)
		.where(eq(atlassianAuth.service, "jira"))
		.get();
	return [
		...(linear
			? [{ provider: "linear" as const, accountId: linear.accountId, siteId: "linear.app" }]
			: []),
		...(jira?.cloudId
			? [
					{
						provider: "jira" as const,
						accountId: jira.accountId,
						siteId: jira.cloudId,
						siteUrl: jira.siteUrl ?? undefined,
					},
				]
			: []),
	];
}
export function isTicketQueueItemCurrent(item: ActivityQueueItem): boolean {
	if (item.target.type !== "ticket") return true;
	const target = item.target;
	return currentTicketQueueAccounts().some(
		(account) => ticketAccountKey(account) === ticketAccountKey(target)
	);
}
export function ticketQueueAccountCurrent(account: TicketQueueAccount): boolean {
	return currentTicketQueueAccounts().some(
		(current) => ticketAccountKey(current) === ticketAccountKey(account)
	);
}
function linkKey(account: TicketQueueAccount, ticketId: string, workspaceId: string): string {
	return `queue-ticket-link:${ticketQueueSourceId(account, ticketId)}:${encodeURIComponent(workspaceId)}`;
}
export function recordTicketQueueLink(
	account: TicketQueueAccount,
	ticketId: string,
	workspaceId: string
): void {
	if (!ticketQueueAccountCurrent(account))
		throw new Error("Ticket account changed; refresh the queue.");
	writeSetting(linkKey(account, ticketId, workspaceId), "verified");
	const queue = getActivityQueueService();
	const source = queue.read(ticketQueueSourceId(account, ticketId));
	if (source?.candidate?.kind === "ticket-start") queue.resolve(source.sourceId);
}
export function ticketQueueLinks(account: TicketQueueAccount): Map<string, TicketQueueLink> {
	const rows = getDb()
		.select({
			ticketId: ticketBranchLinks.ticketId,
			workspaceId: workspaces.id,
			workspaceName: workspaces.name,
			projectId: projects.id,
			projectName: projects.name,
		})
		.from(ticketBranchLinks)
		.innerJoin(workspaces, eq(workspaces.id, ticketBranchLinks.workspaceId))
		.innerJoin(projects, eq(projects.id, workspaces.projectId))
		.where(eq(ticketBranchLinks.provider, account.provider))
		.all();
	const result = new Map<string, TicketQueueLink>();
	for (const row of rows) {
		const verified = readSetting(linkKey(account, row.ticketId, row.workspaceId)) === "verified";
		// Legacy Linear UUID links are globally unique; Jira keys have no such guarantee.
		if (verified || account.provider === "linear") result.set(row.ticketId, row);
	}
	return result;
}
let running: Promise<void> | null = null;
async function poll(): Promise<void> {
	const queue = getActivityQueueService();
	await Promise.all(
		currentTicketQueueAccounts().map(async (account) => {
			const observedAt = Date.now();
			try {
				const facts = await fetchTicketQueueFacts(account, account.siteUrl);
				if (!ticketQueueAccountCurrent(account)) return;
				const links = ticketQueueLinks(account);
				// Bounded concurrent comments: a failed ticket keeps its previous feedback.
				for (let offset = 0; offset < facts.length; offset += 4) {
					await Promise.all(
						facts.slice(offset, offset + 4).map(async (fact) => {
							if (fact.state !== "started" && !links.has(fact.id)) return;
							try {
								fact.comments = await fetchTicketQueueComments(account, fact.id);
							} catch {
								fact.commentsError =
									"Ticket comments could not be refreshed. The last confirmed feedback is retained.";
							}
						})
					);
				}
				if (!ticketQueueAccountCurrent(account)) return;
				observeTicketPoll(
					{ account, facts, links, showAll: getTicketQueueSettings().showAll, observedAt },
					queue
				);
			} catch {
				if (ticketQueueAccountCurrent(account))
					markTicketPollUnavailable(
						account,
						"Ticket provider could not be refreshed. The last confirmed items are retained.",
						queue
					);
			}
		})
	);
}
export function refreshTicketQueue(): Promise<void> {
	if (!running)
		running = poll().finally(() => {
			running = null;
		});
	return running;
}
let interval: ReturnType<typeof setInterval> | null = null;
export function initializeTicketQueue(): void {
	if (interval) return;
	void refreshTicketQueue();
	interval = setInterval(() => void refreshTicketQueue(), 60_000);
	interval.unref();
}

/** Read-only Open/Start preparation validates the exact occurrence and active account. */
export function prepareTicketQueueAction(input: {
	id: string;
	revision: number;
	action: "open" | "start";
}) {
	const source = getActivityQueueService().read(input.id);
	const candidate = source?.candidate;
	if (
		!source ||
		source.revision !== input.revision ||
		!candidate ||
		candidate.target.type !== "ticket"
	)
		throw new Error("This ticket occurrence changed. Refresh the queue.");
	if (!ticketQueueAccountCurrent(candidate.target))
		throw new Error("The ticket account changed. Refresh the queue.");
	if (
		input.action === "start" &&
		(source.error ||
			candidate.kind !== "ticket-start" ||
			ticketQueueLinks(candidate.target).has(candidate.target.ticketId))
	)
		throw new Error("This ticket is no longer ready to start. Refresh the queue.");
	return { target: candidate.target, title: candidate.title, settings: getTicketQueueSettings() };
}
