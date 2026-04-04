export type TicketProvider = "linear" | "jira";

export interface TicketStatus {
	id: string; // stateId (Linear) or transitionId (Jira)
	name: string;
	color: string; // hex color for the status dot
	categoryKey?: string; // Jira statusCategory key (e.g. "new", "indeterminate", "done")
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
	const diffMs = Date.now() - new Date(dateStr).getTime();
	const diffMin = Math.floor(diffMs / 60_000);
	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return `${diffDay}d ago`;
	return `${Math.floor(diffDay / 30)}mo ago`;
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

/** Maps a board column category to the Jira statusCategory key for transition matching. */
export function columnToJiraCategory(column: NormalizedStatusCategory): string {
	switch (column) {
		case "in_progress":
			return "indeterminate";
		case "done":
			return "done";
		default:
			return "new";
	}
}

/** Maps a board column category to the Linear stateType for state matching. */
export function columnToLinearStateType(
	column: NormalizedStatusCategory
): "backlog" | "unstarted" | "started" | "completed" {
	switch (column) {
		case "backlog":
			return "backlog";
		case "in_progress":
			return "started";
		case "done":
			return "completed";
		default:
			return "unstarted";
	}
}
