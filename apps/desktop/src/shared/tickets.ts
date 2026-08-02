export type TicketProvider = "linear" | "jira";

export type TicketNavigationTarget =
	| { kind: "all" }
	| {
			kind: "group";
			provider: TicketProvider;
			groupId: string;
			contextId?: string;
	  };

export type TicketIterationState = "active" | "future" | "closed";

export type TicketPlanningBucket = "active" | "future" | "backlog" | "closed";

export interface TicketPlanningAssignment {
	contextId: string;
	iterationIds: string[];
	bucket: TicketPlanningBucket;
}

export interface TicketBoardColumn {
	id: string;
	name: string;
	statusIds: string[];
	min?: number;
	max?: number;
}

export interface TicketPlanningContext {
	id: string;
	provider: TicketProvider;
	groupId: string;
	name: string;
	kind: "board" | "team";
	supportsIterations: boolean;
	selected: boolean;
	boardType?: "scrum" | "kanban" | "simple";
	columns?: TicketBoardColumn[];
}

export interface TicketIteration {
	id: string;
	provider: TicketProvider;
	contextId: string;
	groupId: string;
	name: string;
	state: TicketIterationState;
	startAt: string | null;
	endAt: string | null;
}

export type TicketScope =
	| { kind: "current" }
	| { kind: "backlog" }
	| { kind: "all_open" }
	| {
			kind: "iteration";
			provider: TicketProvider;
			iterationId: string;
	  };

export interface TicketStatus {
	id: string; // stateId (Linear) or transitionId (Jira)
	name: string;
	color: string; // hex color for the status dot
	categoryKey?: string; // Jira statusCategory key (e.g. "new", "indeterminate", "done")
	targetStatusId?: string; // Jira transition destination status ID
	targetStatusName?: string; // Jira transition destination status name
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
	planning?: TicketPlanningAssignment;
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
	return ASSIGNEE_PALETTE[Math.abs(hash) % ASSIGNEE_PALETTE.length] ?? "#6e6e73";
}

export function serializeAssigneeFilter(value: AssigneeFilterValue): string {
	return typeof value === "object" ? JSON.stringify(value) : value;
}

export const UNASSIGNED_FILTER_KEY = "__unassigned__";

/**
 * Given the current filter value and the key the user toggled (a userId or
 * UNASSIGNED_FILTER_KEY), compute the next filter state. Pure — extracted from
 * AssigneeFilter so the 8-branch state machine is directly testable.
 */
export function computeNextAssigneeFilter(
	current: AssigneeFilterValue,
	key: string,
	meIds: string[]
): AssigneeFilterValue {
	if (key === UNASSIGNED_FILTER_KEY) {
		if (current === "all") return { userIds: [], includeUnassigned: true };
		if (current === "me") return { userIds: meIds, includeUnassigned: true };
		const next = { ...current, includeUnassigned: !current.includeUnassigned };
		if (next.userIds.length === 0 && !next.includeUnassigned) return "all";
		return next;
	}

	if (current === "all") {
		return { userIds: [key], includeUnassigned: false };
	}
	if (current === "me") {
		if (meIds.includes(key)) return "all";
		return { userIds: [key], includeUnassigned: false };
	}

	const nextIds = current.userIds.includes(key)
		? current.userIds.filter((id) => id !== key)
		: [...current.userIds, key];
	if (nextIds.length === 0 && !current.includeUnassigned) return "all";
	return { userIds: nextIds, includeUnassigned: current.includeUnassigned };
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

export function isTicketScope(value: unknown): value is TicketScope {
	if (!value || typeof value !== "object") return false;
	const scope = value as Record<string, unknown>;
	if (scope["kind"] === "current" || scope["kind"] === "backlog" || scope["kind"] === "all_open") {
		return true;
	}
	return (
		scope["kind"] === "iteration" &&
		(scope["provider"] === "linear" || scope["provider"] === "jira") &&
		typeof scope["iterationId"] === "string"
	);
}

export function isTicketNavigationTarget(value: unknown): value is TicketNavigationTarget {
	if (!value || typeof value !== "object") return false;
	const target = value as Record<string, unknown>;
	if (target["kind"] === "all") return true;
	return (
		target["kind"] === "group" &&
		(target["provider"] === "linear" || target["provider"] === "jira") &&
		typeof target["groupId"] === "string" &&
		(target["contextId"] === undefined || typeof target["contextId"] === "string")
	);
}

export function ticketNavigationTargetsEqual(
	a: TicketNavigationTarget | null | undefined,
	b: TicketNavigationTarget | null | undefined
): boolean {
	if (!a || !b || a.kind !== b.kind) return false;
	if (a.kind === "all" || b.kind === "all") return a.kind === b.kind;
	if (a.provider !== b.provider || a.groupId !== b.groupId) return false;
	// Linear's planning context is the team itself, so groupId is already exhaustive.
	// Ignore contextId for compatibility with defaults saved by early planning builds.
	return a.provider === "linear" || a.contextId === b.contextId;
}

export function matchesTicketScope(
	issue: Pick<MergedTicketIssue, "provider" | "statusCategory" | "stateType" | "planning">,
	scope: TicketScope,
	supportsIterations = true
): boolean {
	const category = normalizeStatusCategory(issue.provider, issue.statusCategory, issue.stateType);
	if (scope.kind === "all_open") return category !== "done";

	if (scope.kind === "iteration") {
		return (
			issue.provider === scope.provider &&
			(issue.planning?.iterationIds.includes(scope.iterationId) ?? false)
		);
	}

	// A synthetic Jira project fallback has no planning assignment. Real Kanban
	// boards also have no iterations, but do have active/backlog placement.
	if (!supportsIterations && !issue.planning) return category !== "done";

	if (scope.kind === "backlog") {
		return category !== "done" && issue.planning?.bucket === "backlog";
	}

	return issue.planning?.bucket === "active";
}

/**
 * Jira projects may expose multiple boards with different filters. Once a
 * board is selected, only issues confirmed by that board's Agile snapshot
 * belong on its canvas. The project-level cache remains complete underneath.
 */
export function matchesTicketPlanningContext(
	issue: Pick<MergedTicketIssue, "provider" | "planning">,
	context: TicketPlanningContext | undefined
): boolean {
	if (!context || context.provider !== "jira" || context.id.startsWith("jira-project:"))
		return true;
	return issue.provider === "jira" && issue.planning?.contextId === context.id;
}
