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
			case "new":
			default:
				return "todo";
		}
	}
	// Linear
	switch (stateType) {
		case "triage":
		case "backlog":
			return "backlog";
		case "started":
			return "in_progress";
		case "completed":
		case "cancelled":
			return "done";
		case "unstarted":
		default:
			return "todo";
	}
}
