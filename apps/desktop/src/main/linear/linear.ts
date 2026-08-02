import type { TicketPlanningAssignment } from "../../shared/tickets";
import { linearFetch } from "./auth";

// ── Public types ──────────────────────────────────────────────────────────────

export type WorkflowStateType =
	| "triage"
	| "backlog"
	| "unstarted"
	| "started"
	| "completed"
	| "cancelled";

export interface LinearTeam {
	id: string;
	name: string;
	key: string;
}

export interface LinearWorkflowState {
	id: string;
	name: string;
	color: string;
	type: WorkflowStateType;
	position: number;
}

export interface LinearIssue {
	id: string;
	identifier: string;
	title: string;
	url: string;
	stateId: string;
	stateName: string;
	stateColor: string;
	stateType: WorkflowStateType;
	teamId: string;
	teamName: string;
	assigneeId: string | null;
	assigneeName: string | null;
	assigneeAvatar: string | null;
	updatedAt: string;
	cycleId: string | null;
	cycleName: string | null;
	planning: TicketPlanningAssignment;
}

export interface LinearCycle {
	id: string;
	teamId: string;
	name: string;
	state: "active" | "future" | "closed";
	startAt: string | null;
	endAt: string | null;
}

export interface LinearTeamMember {
	id: string;
	name: string;
	email: string | null;
	avatarUrl: string | null;
}

// ── Raw GraphQL node types ────────────────────────────────────────────────────

interface RawTeamNode {
	id: string;
	name: string;
	key: string;
}

interface RawStateNode {
	id: string;
	name: string;
	color: string;
	type: WorkflowStateType;
	position: number;
}

interface RawIssueNode {
	id: string;
	identifier: string;
	title: string;
	url: string;
	state: { id: string; name: string; color: string; type: WorkflowStateType };
	team: { id: string; name: string };
	assignee: { id: string; name: string; avatarUrl: string | null } | null;
	updatedAt: string;
	cycle: RawCycleNode | null;
}

interface RawCycleNode {
	id: string;
	name: string | null;
	number: number;
	startsAt: string | null;
	endsAt: string | null;
	completedAt: string | null;
}

type IssueConnectionResponse = {
	issues: {
		nodes: RawIssueNode[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
};

type CycleConnectionResponse = {
	team: {
		cycles: {
			nodes: RawCycleNode[];
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
		};
	};
};

type TeamConnectionResponse = {
	teams: {
		nodes: RawTeamNode[];
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
};

// ── Pure mapping functions (exported for testing) ─────────────────────────────

export function mapTeamNode(node: RawTeamNode): LinearTeam {
	return { id: node.id, name: node.name, key: node.key };
}

export function mapStateNode(node: RawStateNode): LinearWorkflowState {
	return {
		id: node.id,
		name: node.name,
		color: node.color,
		type: node.type,
		position: node.position,
	};
}

export function mapIssueNode(node: RawIssueNode): LinearIssue {
	const cycleState = node.cycle ? getCycleState(node.cycle) : null;
	return {
		id: node.id,
		identifier: node.identifier,
		title: node.title,
		url: node.url,
		stateId: node.state.id,
		stateName: node.state.name,
		stateColor: node.state.color,
		stateType: node.state.type,
		teamId: node.team.id,
		teamName: node.team.name,
		assigneeId: node.assignee?.id ?? null,
		assigneeName: node.assignee?.name ?? null,
		assigneeAvatar: node.assignee?.avatarUrl ?? null,
		updatedAt: node.updatedAt,
		cycleId: node.cycle?.id ?? null,
		cycleName: node.cycle ? (node.cycle.name ?? `Cycle ${node.cycle.number}`) : null,
		planning: {
			contextId: node.team.id,
			iterationIds: node.cycle ? [node.cycle.id] : [],
			bucket: cycleState ?? "backlog",
		},
	};
}

function getCycleState(cycle: RawCycleNode): "active" | "future" | "closed" {
	if (cycle.completedAt) return "closed";
	const now = Date.now();
	const start = cycle.startsAt ? new Date(cycle.startsAt).getTime() : Number.NEGATIVE_INFINITY;
	const end = cycle.endsAt ? new Date(cycle.endsAt).getTime() : Number.POSITIVE_INFINITY;
	if (start > now) return "future";
	if (end < now) return "closed";
	return "active";
}

// ── API functions ─────────────────────────────────────────────────────────────

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
	const res = await linearFetch({ query, variables });
	const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
	if (json.errors && json.errors.length > 0) {
		throw new Error(`Linear API error: ${json.errors.map((e) => e.message).join(", ")}`);
	}
	if (!json.data) throw new Error("Linear API returned no data");
	return json.data;
}

export async function getTeams(): Promise<LinearTeam[]> {
	const teams: LinearTeam[] = [];
	let after: string | null = null;
	while (true) {
		const data: TeamConnectionResponse = await gql<TeamConnectionResponse>(
			`query Teams($after: String) {
				teams(first: 50, after: $after) {
					nodes { id name key }
					pageInfo { hasNextPage endCursor }
				}
			}`,
			{ after }
		);
		teams.push(...data.teams.nodes.map(mapTeamNode));
		if (!data.teams.pageInfo.hasNextPage || !data.teams.pageInfo.endCursor) break;
		after = data.teams.pageInfo.endCursor;
	}
	return teams;
}

const ISSUE_FIELDS = `id identifier title url updatedAt
	state { id name color type }
	team { id name }
	assignee { id name avatarUrl }
	cycle { id name number startsAt endsAt completedAt }`;

export async function getTeamCycles(teamId: string): Promise<LinearCycle[]> {
	const cycles: LinearCycle[] = [];
	let after: string | null = null;

	while (true) {
		const data: CycleConnectionResponse = await gql<CycleConnectionResponse>(
			`query TeamCycles($teamId: ID!, $after: String) {
				team(id: $teamId) {
					cycles(first: 50, after: $after) {
						nodes { id name number startsAt endsAt completedAt }
						pageInfo { hasNextPage endCursor }
					}
				}
			}`,
			{ teamId, after }
		);
		cycles.push(
			...data.team.cycles.nodes.map((cycle) => ({
				id: cycle.id,
				teamId,
				name: cycle.name ?? `Cycle ${cycle.number}`,
				state: getCycleState(cycle),
				startAt: cycle.startsAt,
				endAt: cycle.endsAt,
			}))
		);
		if (!data.team.cycles.pageInfo.hasNextPage || !data.team.cycles.pageInfo.endCursor) break;
		after = data.team.cycles.pageInfo.endCursor;
	}
	return cycles;
}

export async function getTeamIssues(teamId?: string): Promise<LinearIssue[]> {
	const allNodes: RawIssueNode[] = [];
	let cursor: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: IssueConnectionResponse = await gql<IssueConnectionResponse>(
			`query TeamIssues($cursor: String${teamId ? ", $teamId: ID!" : ""}) {
				issues(
					first: 50
					after: $cursor
					filter: {
						state: { type: { nin: ["completed", "cancelled"] } }
						${teamId ? "team: { id: { eq: $teamId } }" : ""}
					}
					orderBy: updatedAt
				) {
					nodes { ${ISSUE_FIELDS} }
					pageInfo { hasNextPage endCursor }
				}
			}`,
			teamId ? { cursor, teamId } : { cursor }
		);

		allNodes.push(...data.issues.nodes);
		hasNextPage = data.issues.pageInfo.hasNextPage;
		cursor = data.issues.pageInfo.endCursor;
	}

	return allNodes.map(mapIssueNode);
}

export async function getTeamIssuesWithDone(
	teamId?: string,
	cutoffDays = 14,
	selectedCycleId?: string
): Promise<LinearIssue[]> {
	// 1. Fetch non-done issues (exclude completed/cancelled)
	const activeNodes: RawIssueNode[] = [];
	let cursor: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: IssueConnectionResponse = await gql<IssueConnectionResponse>(
			`query ActiveTeamIssues($cursor: String${teamId ? ", $teamId: ID!" : ""}) {
				issues(
					first: 50
					after: $cursor
					filter: {
						state: { type: { nin: ["completed", "cancelled"] } }
						${teamId ? "team: { id: { eq: $teamId } }" : ""}
					}
					orderBy: updatedAt
				) {
					nodes { ${ISSUE_FIELDS} }
					pageInfo { hasNextPage endCursor }
				}
			}`,
			teamId ? { cursor, teamId } : { cursor }
		);

		activeNodes.push(...data.issues.nodes);
		hasNextPage = data.issues.pageInfo.hasNextPage;
		cursor = data.issues.pageInfo.endCursor;
	}

	// 2. Fetch done issues from active cycle
	const doneNodes: RawIssueNode[] = [];

	try {
		let doneCursor: string | null = null;
		let doneHasNext = true;
		while (doneHasNext) {
			const cycleData: IssueConnectionResponse = await gql<IssueConnectionResponse>(
				`query DoneCycleTeamIssues($cursor: String${teamId ? ", $teamId: ID!" : ""}) {
					issues(
						first: 50
						after: $cursor
						filter: {
							state: { type: { in: ["completed", "cancelled"] } }
							cycle: { isActive: { eq: true } }
							${teamId ? "team: { id: { eq: $teamId } }" : ""}
						}
						orderBy: updatedAt
					) {
						nodes { ${ISSUE_FIELDS} }
						pageInfo { hasNextPage endCursor }
					}
				}`,
				teamId ? { cursor: doneCursor, teamId } : { cursor: doneCursor }
			);
			doneNodes.push(...cycleData.issues.nodes);
			doneHasNext = cycleData.issues.pageInfo.hasNextPage;
			doneCursor = cycleData.issues.pageInfo.endCursor;
		}
	} catch {
		// Cycle query failed — no active cycle
	}

	// 3. Fall back to time-based if cycle returned nothing
	if (doneNodes.length === 0) {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
		const cutoffIso = cutoffDate.toISOString();

		try {
			let timeCursor: string | null = null;
			let timeHasNext = true;
			while (timeHasNext) {
				const timeData: IssueConnectionResponse = await gql<IssueConnectionResponse>(
					`query DoneTimeTeamIssues($cutoffDate: DateTime, $cursor: String${teamId ? ", $teamId: ID!" : ""}) {
						issues(
							first: 50
							after: $cursor
							filter: {
								state: { type: { in: ["completed", "cancelled"] } }
								completedAt: { gte: $cutoffDate }
								${teamId ? "team: { id: { eq: $teamId } }" : ""}
							}
							orderBy: updatedAt
						) {
							nodes { ${ISSUE_FIELDS} }
							pageInfo { hasNextPage endCursor }
						}
					}`,
					teamId
						? { cutoffDate: cutoffIso, cursor: timeCursor, teamId }
						: { cutoffDate: cutoffIso, cursor: timeCursor }
				);
				doneNodes.push(...timeData.issues.nodes);
				timeHasNext = timeData.issues.pageInfo.hasNextPage;
				timeCursor = timeData.issues.pageInfo.endCursor;
			}
		} catch {
			// Time query also failed
		}
	}

	// 4. Explicitly load a selected historical cycle for iteration browsing.
	if (selectedCycleId) {
		try {
			let selectedCursor: string | null = null;
			let selectedHasNext = true;
			while (selectedHasNext) {
				const selectedData: IssueConnectionResponse = await gql<IssueConnectionResponse>(
					`query SelectedCycleIssues($cycleId: ID!, $cursor: String${teamId ? ", $teamId: ID" : ""}) {
						issues(
							first: 50
							after: $cursor
							filter: {
								cycle: { id: { eq: $cycleId } }
								${teamId ? "team: { id: { eq: $teamId } }" : ""}
							}
							orderBy: updatedAt
						) {
							nodes { ${ISSUE_FIELDS} }
							pageInfo { hasNextPage endCursor }
						}
					}`,
					teamId
						? { cycleId: selectedCycleId, cursor: selectedCursor, teamId }
						: { cycleId: selectedCycleId, cursor: selectedCursor }
				);
				doneNodes.push(...selectedData.issues.nodes);
				selectedHasNext = selectedData.issues.pageInfo.hasNextPage;
				selectedCursor = selectedData.issues.pageInfo.endCursor;
			}
		} catch {
			// Preserve the broad issue snapshot if a historical cycle is inaccessible.
		}
	}

	// 5. Merge, dedup by id
	const seen = new Set(activeNodes.map((n) => n.id));
	for (const node of doneNodes) {
		if (!seen.has(node.id)) {
			activeNodes.push(node);
			seen.add(node.id);
		}
	}

	return activeNodes.map(mapIssueNode);
}

export async function getTeamMembers(teamId: string): Promise<LinearTeamMember[]> {
	const all: LinearTeamMember[] = [];
	let after: string | null = null;

	while (true) {
		const data: {
			team: {
				members: {
					nodes: Array<{
						id: string;
						name: string;
						email: string;
						avatarUrl: string | null;
					}>;
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
				};
			};
		} = await gql<{
			team: {
				members: {
					nodes: Array<{
						id: string;
						name: string;
						email: string;
						avatarUrl: string | null;
					}>;
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
				};
			};
		}>(
			`query TeamMembers($teamId: ID!, $after: String) {
				team(id: $teamId) {
					members(first: 50, after: $after) {
						nodes { id name email avatarUrl }
						pageInfo { hasNextPage endCursor }
					}
				}
			}`,
			{ teamId, after }
		);

		for (const m of data.team.members.nodes) {
			all.push({
				id: m.id,
				name: m.name,
				email: m.email ?? null,
				avatarUrl: m.avatarUrl ?? null,
			});
		}

		if (!data.team.members.pageInfo.hasNextPage) break;
		if (!data.team.members.pageInfo.endCursor) break;
		after = data.team.members.pageInfo.endCursor;
	}

	return all;
}

export async function updateIssueAssignee(
	issueId: string,
	assigneeId: string | null
): Promise<void> {
	const data = await gql<{ issueUpdate: { success: boolean } }>(
		`mutation UpdateIssueAssignee($issueId: String!, $assigneeId: String) {
			issueUpdate(id: $issueId, input: { assigneeId: $assigneeId }) {
				success
			}
		}`,
		{ issueId, assigneeId }
	);
	if (!data.issueUpdate.success) {
		throw new Error("Linear issue assignee update failed");
	}
}

export async function getTeamStates(teamId: string): Promise<LinearWorkflowState[]> {
	const data = await gql<{ workflowStates: { nodes: RawStateNode[] } }>(
		`
		query TeamStates($teamId: ID!) {
			workflowStates(filter: { team: { id: { eq: $teamId } } }) {
				nodes { id name color type position }
			}
		}
	`,
		{ teamId }
	);
	return data.workflowStates.nodes.map(mapStateNode);
}

export async function updateIssueState(issueId: string, stateId: string): Promise<void> {
	const data = await gql<{ issueUpdate: { success: boolean } }>(
		`
		mutation UpdateIssueState($issueId: String!, $stateId: String!) {
			issueUpdate(id: $issueId, input: { stateId: $stateId }) {
				success
			}
		}
	`,
		{ issueId, stateId }
	);
	if (!data.issueUpdate.success) {
		throw new Error("Linear issue state update failed");
	}
}

export interface LinearIssueDetail {
	description: string;
	comments: Array<{
		id: string;
		author: string;
		avatarUrl?: string;
		body: string;
		createdAt: string;
	}>;
}

export async function getIssueDetail(issueId: string): Promise<LinearIssueDetail> {
	const data = await gql<{
		issue: {
			description: string | null;
			comments: {
				nodes: Array<{
					id: string;
					body: string;
					createdAt: string;
					user: { name: string; avatarUrl: string | null } | null;
				}>;
			};
		};
	}>(
		`query IssueDetail($id: String!) {
			issue(id: $id) {
				description
				comments {
					nodes {
						id
						body
						createdAt
						user { name avatarUrl }
					}
				}
			}
		}`,
		{ id: issueId }
	);

	return {
		description: data.issue.description ?? "",
		comments: data.issue.comments.nodes.map((c) => ({
			id: c.id,
			author: c.user?.name ?? "Unknown",
			avatarUrl: c.user?.avatarUrl ?? undefined,
			body: c.body,
			createdAt: c.createdAt,
		})),
	};
}
