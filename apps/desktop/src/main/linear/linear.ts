import { linearFetch } from "./auth";

// ── Public types ──────────────────────────────────────────────────────────────

export interface LinearTeam {
	id: string;
	name: string;
	key: string;
}

export interface LinearWorkflowState {
	id: string;
	name: string;
	color: string;
	type: string;
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
	stateType: string;
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
	type: string;
	position: number;
}

interface RawIssueNode {
	id: string;
	identifier: string;
	title: string;
	url: string;
	state: { id: string; name: string; color: string; type: string };
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

	const data = teamId
		? await gql<{ issues: { nodes: RawIssueNode[] } }>(
				`
				query AssignedIssues($teamId: String!) {
					issues(
						first: 50
						filter: { assignee: { isMe: { eq: true } }, team: { id: { eq: $teamId } } }
						orderBy: updatedAt
					) {
						nodes { ${issueFields} }
					}
				}
			`,
				{ teamId }
			)
		: await gql<{ issues: { nodes: RawIssueNode[] } }>(`
				query {
					issues(first: 50, filter: { assignee: { isMe: { eq: true } } }, orderBy: updatedAt) {
						nodes { ${issueFields} }
					}
				}
			`);

	return data.issues.nodes.map(mapIssueNode);
}

export async function getTeamStates(teamId: string): Promise<LinearWorkflowState[]> {
	const data = await gql<{ workflowStates: { nodes: RawStateNode[] } }>(
		`
		query TeamStates($teamId: ID!) {
			workflowStates(filter: { team: { id: { eq: $teamId } } }, orderBy: position) {
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
