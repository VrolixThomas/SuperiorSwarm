import type { TicketIssue, TicketProvider } from "./tickets";

export interface TicketQueueAccount {
	provider: TicketProvider;
	accountId: string;
	siteId: string;
}
export interface TicketQueueComment {
	id: string;
	authorId: string | null;
	author: string;
	body: string;
	createdAt: number;
}
export interface TicketQueueFact extends TicketIssue {
	assigneeId: string | null;
	state: "unstarted" | "started" | "closed" | "other";
	groupName: string;
	comments?: TicketQueueComment[];
	commentsError?: string;
}
export interface TicketQueueLink {
	workspaceId: string;
	workspaceName: string;
	projectId: string;
	projectName: string;
}
export function ticketAccountKey(account: TicketQueueAccount): string {
	return [account.provider, account.accountId, account.siteId].map(encodeURIComponent).join(":");
}
export function ticketQueueSourceId(account: TicketQueueAccount, ticketId: string): string {
	return `ticket:${ticketAccountKey(account)}:${encodeURIComponent(ticketId)}`;
}
