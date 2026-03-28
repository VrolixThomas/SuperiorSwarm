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
}

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
	};
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
	const data = await gql<{ teams: { nodes: RawTeamNode[] } }>(`
		query {
			teams {
				nodes { id name key }
			}
		}
	`);
	return data.teams.nodes.map(mapTeamNode);
}

export async function getAssignedIssues(teamId?: string): Promise<LinearIssue[]> {
	const issueFields = `id identifier title url
		state { id name color type }
		team { id name }`;

	const allNodes: RawIssueNode[] = [];
	let cursor: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data = await gql<{
			issues: {
				nodes: RawIssueNode[];
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		}>(
			`query AssignedIssues($cursor: String${teamId ? ", $teamId: String" : ""}) {
				issues(
					first: 50
					after: $cursor
					filter: {
						assignee: { isMe: { eq: true } }
						${teamId ? "team: { id: { eq: $teamId } }" : ""}
					}
					orderBy: updatedAt
				) {
					nodes { ${issueFields} }
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

export async function getAssignedIssuesWithDone(
	teamId?: string,
	cutoffDays: number = 14,
): Promise<LinearIssue[]> {
	const issueFields = `id identifier title url
		state { id name color type }
		team { id name }`;

	// 1. Fetch non-done issues (exclude completed/cancelled)
	const activeNodes: RawIssueNode[] = [];
	let cursor: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data = await gql<{
			issues: {
				nodes: RawIssueNode[];
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		}>(
			`query ActiveIssues($cursor: String${teamId ? ", $teamId: String" : ""}) {
				issues(
					first: 50
					after: $cursor
					filter: {
						assignee: { isMe: { eq: true } }
						state: { type: { nin: ["completed", "cancelled"] } }
						${teamId ? "team: { id: { eq: $teamId } }" : ""}
					}
					orderBy: updatedAt
				) {
					nodes { ${issueFields} }
					pageInfo { hasNextPage endCursor }
				}
			}`,
			teamId ? { cursor, teamId } : { cursor },
		);

		activeNodes.push(...data.issues.nodes);
		hasNextPage = data.issues.pageInfo.hasNextPage;
		cursor = data.issues.pageInfo.endCursor;
	}

	// 2. Fetch done issues from active cycle
	let doneNodes: RawIssueNode[] = [];

	try {
		const cycleData = await gql<{
			issues: {
				nodes: RawIssueNode[];
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
			};
		}>(
			`query DoneCycleIssues${teamId ? "($teamId: String)" : ""} {
				issues(
					first: 50
					filter: {
						assignee: { isMe: { eq: true } }
						state: { type: { in: ["completed", "cancelled"] } }
						cycle: { isActive: { eq: true } }
						${teamId ? "team: { id: { eq: $teamId } }" : ""}
					}
					orderBy: updatedAt
				) {
					nodes { ${issueFields} }
					pageInfo { hasNextPage endCursor }
				}
			}`,
			teamId ? { teamId } : undefined,
		);
		doneNodes = cycleData.issues.nodes;
	} catch {
		// Cycle query failed — no active cycle
	}

	// 3. Fall back to time-based if cycle returned nothing
	if (doneNodes.length === 0) {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - cutoffDays);
		const cutoffIso = cutoffDate.toISOString();

		try {
			const timeData = await gql<{
				issues: {
					nodes: RawIssueNode[];
					pageInfo: { hasNextPage: boolean; endCursor: string | null };
				};
			}>(
				`query DoneTimeIssues($cutoffDate: DateTime${teamId ? ", $teamId: String" : ""}) {
					issues(
						first: 50
						filter: {
							assignee: { isMe: { eq: true } }
							state: { type: { in: ["completed", "cancelled"] } }
							completedAt: { gte: $cutoffDate }
							${teamId ? "team: { id: { eq: $teamId } }" : ""}
						}
						orderBy: updatedAt
					) {
						nodes { ${issueFields} }
						pageInfo { hasNextPage endCursor }
					}
				}`,
				teamId ? { cutoffDate: cutoffIso, teamId } : { cutoffDate: cutoffIso },
			);
			doneNodes = timeData.issues.nodes;
		} catch {
			// Time query also failed
		}
	}

	// 4. Merge, dedup by id
	const seen = new Set(activeNodes.map((n) => n.id));
	for (const node of doneNodes) {
		if (!seen.has(node.id)) {
			activeNodes.push(node);
			seen.add(node.id);
		}
	}

	return activeNodes.map(mapIssueNode);
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
