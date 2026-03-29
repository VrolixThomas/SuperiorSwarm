export type TicketProvider = "linear" | "jira";

export interface TicketStatus {
	id: string; // stateId (Linear) or transitionId (Jira)
	name: string;
	color: string; // hex color for the status dot
}

export interface TicketIssue {
	provider: TicketProvider;
	id: string; // Linear UUID or Jira issue key (e.g. "PROJ-123")
	identifier: string; // display key shown in the UI
	title: string;
	url: string;
	status: TicketStatus;
	groupId: string; // teamId (Linear) or projectKey (Jira) — used to scope status fetches
}

export type NormalizedStatusCategory = "backlog" | "todo" | "in_progress" | "done";

export interface MergedTicketIssue extends TicketIssue {
	stateType?: string;
	teamName?: string;
	projectKey?: string;
	updatedAt?: string;
	statusCategory?: string;
}

export type TicketViewMode = "board" | "list" | "table";

export interface TicketProject {
	id: string;
	name: string;
	provider: TicketProvider;
	count: number;
}

export interface TicketDetailData {
	description: string;
	comments: TicketComment[];
}

export interface TicketComment {
	id: string;
	author: string;
	avatarUrl?: string;
	body: string;
	createdAt: string;
}

export function formatRelativeTime(dateStr: string | undefined): string {
	if (!dateStr) return "";
	const diff = Date.now() - new Date(dateStr).getTime();
	const hours = Math.floor(diff / 3_600_000);
	if (hours < 1) return "just now";
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(dateStr).toLocaleDateString();
}

export function columnStateType(category: string): string {
	switch (category) {
		case "backlog":
			return "backlog";
		case "todo":
			return "unstarted";
		case "in_progress":
			return "started";
		case "done":
			return "completed";
		default:
			return "default";
	}
}

export function normalizeStatusCategory(
	provider: TicketProvider,
	statusCategory?: string,
	stateType?: string
): NormalizedStatusCategory {
	if (provider === "jira") {
		switch (statusCategory) {
			case "indeterminate":
				return "in_progress";
			case "done":
				return "done";
			default:
				return "todo";
		}
	}
	switch (stateType) {
		case "triage":
		case "backlog":
			return "backlog";
		case "started":
			return "in_progress";
		case "completed":
		case "cancelled":
			return "done";
		default:
			return "todo";
	}
}
