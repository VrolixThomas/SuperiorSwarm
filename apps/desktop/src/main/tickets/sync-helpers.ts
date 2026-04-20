import type { JiraIssue } from "../atlassian/jira";
import type { LinearIssue } from "../linear/linear";

export interface JiraProjectAssignees {
	projectKey: string;
	members: Array<{ userId: string; name: string; email: null; avatarUrl: string | null }>;
}

export function extractJiraAssignees(issues: JiraIssue[]): JiraProjectAssignees[] {
	const byProject = new Map<string, Map<string, { name: string; avatarUrl: string | null }>>();

	for (const issue of issues) {
		if (!issue.assigneeId || !issue.assigneeName) continue;
		let proj = byProject.get(issue.projectKey);
		if (!proj) {
			proj = new Map();
			byProject.set(issue.projectKey, proj);
		}
		if (!proj.has(issue.assigneeId)) {
			proj.set(issue.assigneeId, {
				name: issue.assigneeName,
				avatarUrl: issue.assigneeAvatar ?? null,
			});
		}
	}

	return [...byProject.entries()].map(([projectKey, members]) => ({
		projectKey,
		members: [...members.entries()].map(([userId, m]) => ({
			userId,
			name: m.name,
			email: null,
			avatarUrl: m.avatarUrl,
		})),
	}));
}

export interface LinearTeamAssignees {
	teamId: string;
	members: Array<{ userId: string; name: string; email: null; avatarUrl: string | null }>;
}

export function extractLinearAssignees(issues: LinearIssue[]): LinearTeamAssignees[] {
	const byTeam = new Map<string, Map<string, { name: string; avatarUrl: string | null }>>();

	for (const issue of issues) {
		if (!issue.assigneeId || !issue.assigneeName) continue;
		let team = byTeam.get(issue.teamId);
		if (!team) {
			team = new Map();
			byTeam.set(issue.teamId, team);
		}
		if (!team.has(issue.assigneeId)) {
			team.set(issue.assigneeId, {
				name: issue.assigneeName,
				avatarUrl: issue.assigneeAvatar ?? null,
			});
		}
	}

	return [...byTeam.entries()].map(([teamId, members]) => ({
		teamId,
		members: [...members.entries()].map(([userId, m]) => ({
			userId,
			name: m.name,
			email: null,
			avatarUrl: m.avatarUrl,
		})),
	}));
}
