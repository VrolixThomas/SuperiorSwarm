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
	assigneeId?: string | null;
	assigneeName?: string | null;
	assigneeAvatar?: string | null;
}

export interface TicketTeam {
	id: string;
	provider: TicketProvider;
	name: string;
}

export interface TicketTeamMember {
	id: string;
	provider: TicketProvider;
	name: string;
	email?: string;
	avatarUrl?: string;
}

export type AssigneeFilterValue = "all" | "me" | { userIds: string[]; includeUnassigned: boolean };

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

const ASSIGNEE_PALETTE = [
	"#E06C75",
	"#E5C07B",
	"#61AFEF",
	"#C678DD",
	"#56B6C2",
	"#98C379",
	"#D19A66",
	"#BE5046",
	"#7EC8E3",
	"#C8A2C8",
];

export function assigneeColorFromId(id: string | null | undefined): string {
	if (!id) return "#6e6e73";
	let hash = 0;
	for (let i = 0; i < id.length; i++) {
		hash = (hash * 31 + id.charCodeAt(i)) | 0;
	}
	return ASSIGNEE_PALETTE[Math.abs(hash) % ASSIGNEE_PALETTE.length]!;
}

export function serializeAssigneeFilter(value: AssigneeFilterValue): string {
	return typeof value === "object" ? JSON.stringify(value) : value;
}

export function deserializeAssigneeFilter(raw: string | null): AssigneeFilterValue {
	if (!raw || raw === "me") return "me";
	if (raw === "all") return "all";
	try {
		const parsed = JSON.parse(raw);
		if (parsed && Array.isArray(parsed.userIds) && typeof parsed.includeUnassigned === "boolean") {
			return parsed;
		}
	} catch {}
	return "me";
}
