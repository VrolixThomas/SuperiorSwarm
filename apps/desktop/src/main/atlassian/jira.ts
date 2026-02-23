import { atlassianFetch, getAuth } from "./auth";

export interface JiraIssue {
	key: string;
	summary: string;
	status: string;
	statusCategory: string;
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

	return data.issues.map((issue) => ({
		key: issue.key,
		summary: issue.fields.summary,
		status: issue.fields.status.name,
		statusCategory: issue.fields.status.statusCategory.key,
		priority: issue.fields.priority?.name ?? "None",
		issueType: issue.fields.issuetype.name,
		projectKey: issue.fields.project.key,
		webUrl: `https://api.atlassian.com/ex/jira/${auth.cloudId}/browse/${issue.key}`,
		createdAt: issue.fields.created,
		updatedAt: issue.fields.updated,
	}));
}
