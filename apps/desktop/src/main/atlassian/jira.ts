import { type TicketStatus } from "../../shared/tickets";
import { atlassianFetch, getAuth } from "./auth";

export interface JiraIssue {
	key: string;
	summary: string;
	status: string;
	statusCategory: string;
	statusColor: string;
	priority: string;
	issueType: string;
	projectKey: string;
	webUrl: string;
	createdAt: string;
	updatedAt: string;
}

interface JiraApiIssue {
	key: string;
	fields: {
		summary: string;
		status: { name: string; statusCategory: { key: string } };
		priority: { name: string } | null;
		issuetype: { name: string };
		project: { key: string };
		created: string;
		updated: string;
	};
}

function mapStatusToColor(categoryKey: string): string {
	switch (categoryKey) {
		case "new":
			return "#42526E";
		case "indeterminate":
			return "#0052CC";
		case "done":
			return "#00875A";
		default:
			return "#6c757d";
	}
}

export async function getMyIssues(): Promise<JiraIssue[]> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const jql = "assignee = currentUser() AND resolution IS EMPTY ORDER BY updated DESC";
	const fields = "summary,status,priority,issuetype,project,created,updated";
	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=50`;

	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira search failed: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as { issues: JiraApiIssue[] };
	const baseUrl = auth.siteUrl ?? `https://api.atlassian.com/ex/jira/${auth.cloudId}`;

	return data.issues.map((issue) => ({
		key: issue.key,
		summary: issue.fields.summary,
		status: issue.fields.status.name,
		statusCategory: issue.fields.status.statusCategory.key,
		statusColor: mapStatusToColor(issue.fields.status.statusCategory.key),
		priority: issue.fields.priority?.name ?? "None",
		issueType: issue.fields.issuetype.name,
		projectKey: issue.fields.project.key,
		webUrl: `${baseUrl}/browse/${issue.key}`,
		createdAt: issue.fields.created,
		updatedAt: issue.fields.updated,
	}));
}

export async function getIssueTransitions(issueKey: string): Promise<TicketStatus[]> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/issue/${issueKey}/transitions`;

	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira transitions fetch failed: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as { transitions: any[] };

	return data.transitions.map((t) => ({
		id: t.id,
		name: t.name,
		color: mapStatusToColor(t.to.statusCategory.key),
	}));
}

export async function updateIssueStatus(issueKey: string, transitionId: string): Promise<void> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return;

	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/issue/${issueKey}/transitions`;

	const res = await atlassianFetch("jira", url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ transition: { id: transitionId } }),
	});

	if (!res.ok) {
		throw new Error(`Jira status update failed: ${res.status} ${await res.text()}`);
	}
}
