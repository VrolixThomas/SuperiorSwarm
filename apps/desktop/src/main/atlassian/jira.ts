import type {
	TicketIteration,
	TicketPlanningAssignment,
	TicketPlanningContext,
	TicketStatus,
} from "../../shared/tickets";
import { atlassianFetch, getAuth } from "./auth";

export interface JiraIssue {
	key: string;
	summary: string;
	statusId?: string; // absent only in caches written before board-column support
	status: string;
	statusCategory: string;
	statusColor: string;
	priority: string;
	issueType: string;
	projectKey: string;
	webUrl: string;
	createdAt: string;
	updatedAt: string;
	assigneeId: string | null;
	assigneeName: string | null;
	assigneeAvatar: string | null;
	planning?: TicketPlanningAssignment;
}

interface JiraApiIssue {
	key: string;
	fields: {
		summary: string;
		status: { id: string; name: string; statusCategory: { key: string } };
		priority: { name: string } | null;
		issuetype: { name: string };
		project: { key: string };
		created: string;
		updated: string;
		assignee: {
			accountId: string;
			displayName: string;
			avatarUrls?: Record<string, string>;
		} | null;
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

export function mapApiIssue(issue: JiraApiIssue, baseUrl: string): JiraIssue {
	return {
		key: issue.key,
		summary: issue.fields.summary,
		statusId: issue.fields.status.id,
		status: issue.fields.status.name,
		statusCategory: issue.fields.status.statusCategory.key,
		statusColor: mapStatusToColor(issue.fields.status.statusCategory.key),
		priority: issue.fields.priority?.name ?? "None",
		issueType: issue.fields.issuetype.name,
		projectKey: issue.fields.project.key,
		webUrl: `${baseUrl}/browse/${issue.key}`,
		createdAt: issue.fields.created,
		updatedAt: issue.fields.updated,
		assigneeId: issue.fields.assignee?.accountId ?? null,
		assigneeName: issue.fields.assignee?.displayName ?? null,
		assigneeAvatar: issue.fields.assignee?.avatarUrls?.["24x24"] ?? null,
	};
}

export async function getMyIssues(maxResults = 50): Promise<JiraIssue[]> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const jql = "assignee = currentUser() AND resolution IS EMPTY ORDER BY updated DESC";
	const fields = "summary,status,priority,issuetype,project,created,updated,assignee";
	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${maxResults}`;

	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira search failed: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as { issues: JiraApiIssue[] };
	const baseUrl = auth.siteUrl ?? `https://api.atlassian.com/ex/jira/${auth.cloudId}`;

	return data.issues.map((issue) => mapApiIssue(issue, baseUrl));
}

export async function getMyIssuesWithDone(cutoffDays: number): Promise<JiraIssue[]> {
	const unresolved = await getMyIssues();

	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return unresolved;

	const fields = "summary,status,priority,issuetype,project,created,updated,assignee";
	const cloudId = auth.cloudId;
	const baseUrl = auth.siteUrl ?? `https://api.atlassian.com/ex/jira/${cloudId}`;

	async function fetchDoneByJql(jql: string): Promise<JiraIssue[]> {
		try {
			return await fetchAllJqlPages(cloudId, baseUrl, jql, fields);
		} catch {
			// Swallow so the sprint-query path can fall through to the time-window path.
			return [];
		}
	}

	let doneIssues: JiraIssue[] = [];

	try {
		doneIssues = await fetchDoneByJql(
			"assignee = currentUser() AND resolution IS NOT EMPTY AND sprint in openSprints() ORDER BY updated DESC"
		);
	} catch {
		// Sprint query failed — project may not use sprints
	}

	if (doneIssues.length === 0) {
		try {
			doneIssues = await fetchDoneByJql(
				`assignee = currentUser() AND resolution IS NOT EMPTY AND updated >= -${cutoffDays}d ORDER BY updated DESC`
			);
		} catch {
			// Time query also failed — return unresolved only
		}
	}

	const seen = new Set(unresolved.map((i) => i.key));
	for (const issue of doneIssues) {
		if (!seen.has(issue.key)) {
			unresolved.push(issue);
			seen.add(issue.key);
		}
	}

	return unresolved;
}

// Jira project keys are uppercase letters, digits, underscores; must start with a letter.
// Enforced here because projectKey is interpolated into JQL strings.
const JIRA_PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

function assertValidProjectKeys(projectKeys: string[]): void {
	for (const key of projectKeys) {
		if (!JIRA_PROJECT_KEY_RE.test(key)) {
			throw new Error(`Invalid Jira project key: ${JSON.stringify(key)}`);
		}
	}
}

// Jira Cloud deprecated `/rest/api/3/search` (offset pagination with startAt/total).
// The replacement `/rest/api/3/search/jql` uses cursor pagination: each response contains
// `nextPageToken` (or omits it / sets `isLast: true` on the final page). There is no
// `total` count. Callers must follow tokens until exhausted, otherwise they receive at
// most one page (~50 issues) and silently miss the rest.
async function fetchAllJqlPages(
	cloudId: string,
	baseUrl: string,
	jql: string,
	fields: string,
	maxResults = 100
): Promise<JiraIssue[]> {
	const issues: JiraIssue[] = [];
	let nextPageToken: string | null = null;

	// Safety net against a broken-token edge case some customers have reported where the
	// endpoint returns the same token forever (see Atlassian community threads, 2025).
	const MAX_PAGES = 200;

	for (let page = 0; page < MAX_PAGES; page++) {
		const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
		const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=${maxResults}${tokenParam}`;
		const res = await atlassianFetch("jira", url);
		if (!res.ok) {
			throw new Error(`Jira search failed: ${res.status} ${await res.text()}`);
		}

		const data = (await res.json()) as {
			issues: JiraApiIssue[];
			nextPageToken?: string | null;
			isLast?: boolean;
		};
		for (const issue of data.issues) issues.push(mapApiIssue(issue, baseUrl));

		const prevToken: string | null = nextPageToken;
		nextPageToken = data.nextPageToken ?? null;
		if (
			data.isLast === true ||
			data.issues.length === 0 ||
			nextPageToken === null ||
			nextPageToken === prevToken
		) {
			break;
		}
	}

	return issues;
}

export async function getProjectIssues(projectKeys: string[]): Promise<JiraIssue[]> {
	assertValidProjectKeys(projectKeys);
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const fields = "summary,status,priority,issuetype,project,created,updated,assignee";
	const cloudId = auth.cloudId;
	const baseUrl = auth.siteUrl ?? `https://api.atlassian.com/ex/jira/${cloudId}`;

	async function fetchProject(projectKey: string): Promise<JiraIssue[]> {
		const jql = `project = "${projectKey}" AND resolution IS EMPTY ORDER BY updated DESC`;
		return fetchAllJqlPages(cloudId, baseUrl, jql, fields);
	}

	// Projects fan out in parallel; each project still paginates sequentially (Jira offset
	// cursor-based, not parallelizable per project).
	const perProject = await Promise.all(projectKeys.map(fetchProject));
	return perProject.flat();
}

export async function getProjectIssuesWithDone(
	projectKeys: string[],
	cutoffDays: number
): Promise<JiraIssue[]> {
	assertValidProjectKeys(projectKeys);
	const unresolved = await getProjectIssues(projectKeys);

	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return unresolved;

	const fields = "summary,status,priority,issuetype,project,created,updated,assignee";
	const cloudId = auth.cloudId;
	const baseUrl = auth.siteUrl ?? `https://api.atlassian.com/ex/jira/${cloudId}`;

	async function fetchDoneByJql(jql: string): Promise<JiraIssue[]> {
		try {
			return await fetchAllJqlPages(cloudId, baseUrl, jql, fields);
		} catch {
			// Swallow so the sprint-query path can fall through to the time-window path.
			return [];
		}
	}

	const projectFilter = projectKeys.map((k) => `"${k}"`).join(", ");
	let doneIssues: JiraIssue[] = [];

	try {
		doneIssues = await fetchDoneByJql(
			`project IN (${projectFilter}) AND resolution IS NOT EMPTY AND sprint in openSprints() ORDER BY updated DESC`
		);
	} catch {
		// Sprint query failed
	}

	if (doneIssues.length === 0) {
		try {
			doneIssues = await fetchDoneByJql(
				`project IN (${projectFilter}) AND resolution IS NOT EMPTY AND updated >= -${cutoffDays}d ORDER BY updated DESC`
			);
		} catch {
			// Time query failed
		}
	}

	const seen = new Set(unresolved.map((i) => i.key));
	for (const issue of doneIssues) {
		if (!seen.has(issue.key)) {
			unresolved.push(issue);
			seen.add(issue.key);
		}
	}

	return unresolved;
}

export interface JiraBoard {
	id: string;
	name: string;
	projectKey: string;
	type: "scrum" | "kanban" | "simple";
}

export interface JiraSprint {
	id: string;
	boardId: string;
	name: string;
	state: "active" | "future" | "closed";
	startAt: string | null;
	endAt: string | null;
}

export interface JiraPlanningSnapshot {
	issues: JiraIssue[];
	contexts: TicketPlanningContext[];
	iterations: TicketIteration[];
	failures: Array<{ projectKey: string; message: string }>;
}

function normalizeBoardType(value: string | undefined): JiraBoard["type"] {
	if (value === "kanban" || value === "simple") return value;
	return "scrum";
}

async function getBoardsForProject(projectKey: string): Promise<JiraBoard[]> {
	const auth = getAuth("jira");
	if (!auth?.cloudId) return [];
	const boards: JiraBoard[] = [];
	let startAt = 0;

	for (let page = 0; page < 100; page++) {
		const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKey)}&startAt=${startAt}&maxResults=50`;
		const res = await atlassianFetch("jira", url);
		if (!res.ok) {
			throw new Error(`Jira board search failed: ${res.status} ${await res.text()}`);
		}
		const data = (await res.json()) as {
			values: Array<{ id: number; name: string; type?: string }>;
			isLast?: boolean;
			total?: number;
		};
		boards.push(
			...data.values.map((board) => ({
				id: String(board.id),
				name: board.name,
				projectKey,
				type: normalizeBoardType(board.type),
			}))
		);
		startAt += data.values.length;
		if (
			data.isLast === true ||
			data.values.length === 0 ||
			(typeof data.total === "number" && startAt >= data.total)
		) {
			break;
		}
	}
	return boards;
}

async function getBoardSprints(boardId: string): Promise<JiraSprint[]> {
	const auth = getAuth("jira");
	if (!auth?.cloudId) return [];
	const sprints: JiraSprint[] = [];
	let startAt = 0;

	for (let page = 0; page < 100; page++) {
		const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/sprint?state=active,future,closed&startAt=${startAt}&maxResults=50`;
		const res = await atlassianFetch("jira", url);
		if (!res.ok) {
			throw new Error(`Jira sprint search failed: ${res.status} ${await res.text()}`);
		}
		const data = (await res.json()) as {
			values: Array<{
				id: number;
				name: string;
				state: "active" | "future" | "closed";
				startDate?: string;
				endDate?: string;
			}>;
			isLast?: boolean;
			total?: number;
		};
		sprints.push(
			...data.values.map((sprint) => ({
				id: String(sprint.id),
				boardId,
				name: sprint.name,
				state: sprint.state,
				startAt: sprint.startDate ?? null,
				endAt: sprint.endDate ?? null,
			}))
		);
		startAt += data.values.length;
		if (
			data.isLast === true ||
			data.values.length === 0 ||
			(typeof data.total === "number" && startAt >= data.total)
		) {
			break;
		}
	}
	return sprints;
}

async function getBoardColumns(boardId: string): Promise<TicketPlanningContext["columns"]> {
	const auth = getAuth("jira");
	if (!auth?.cloudId) return [];
	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/agile/1.0/board/${encodeURIComponent(boardId)}/configuration`;
	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira board configuration failed: ${res.status} ${await res.text()}`);
	}
	const data = (await res.json()) as {
		columnConfig?: {
			columns?: Array<{
				name: string;
				statuses?: Array<{ id: string }>;
				min?: number;
				max?: number;
			}>;
		};
	};
	return (data.columnConfig?.columns ?? []).map((column, index) => ({
		id: `${boardId}:${index}`,
		name: column.name,
		statusIds: (column.statuses ?? []).map((status) => String(status.id)),
		...(typeof column.min === "number" ? { min: column.min } : {}),
		...(typeof column.max === "number" ? { max: column.max } : {}),
	}));
}

async function fetchAgileIssues(
	path: string,
	planning: TicketPlanningAssignment
): Promise<JiraIssue[]> {
	const auth = getAuth("jira");
	if (!auth?.cloudId) return [];
	const issues: JiraIssue[] = [];
	const fields = "summary,status,priority,issuetype,project,created,updated,assignee";
	const baseUrl = auth.siteUrl ?? `https://api.atlassian.com/ex/jira/${auth.cloudId}`;
	let nextPageToken: string | null = null;

	for (let page = 0; page < 200; page++) {
		const separator = path.includes("?") ? "&" : "?";
		const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : "";
		const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}${path}${separator}maxResults=100&fields=${fields}${tokenParam}`;
		const res = await atlassianFetch("jira", url);
		if (!res.ok) {
			throw new Error(`Jira Agile issue search failed: ${res.status} ${await res.text()}`);
		}
		const data = (await res.json()) as {
			issues: JiraApiIssue[];
			isLast?: boolean;
			nextPageToken?: string | null;
		};
		issues.push(
			...data.issues.map((issue) => ({
				...mapApiIssue(issue, baseUrl),
				planning,
			}))
		);
		const previousToken: string | null = nextPageToken;
		nextPageToken = data.nextPageToken ?? null;
		if (
			data.isLast === true ||
			data.issues.length === 0 ||
			nextPageToken === null ||
			nextPageToken === previousToken
		) {
			break;
		}
	}
	return issues;
}

const PLANNING_BUCKET_ORDER = {
	active: 4,
	future: 3,
	backlog: 2,
	closed: 1,
} as const;

export function mergeJiraPlanningIssues(issueLists: JiraIssue[][]): JiraIssue[] {
	const merged = new Map<string, JiraIssue>();
	for (const issue of issueLists.flat()) {
		const existing = merged.get(issue.key);
		if (!existing) {
			merged.set(issue.key, issue);
			continue;
		}
		if (!issue.planning) continue;
		if (!existing.planning) {
			merged.set(issue.key, issue);
			continue;
		}
		const bucket =
			PLANNING_BUCKET_ORDER[issue.planning.bucket] > PLANNING_BUCKET_ORDER[existing.planning.bucket]
				? issue.planning.bucket
				: existing.planning.bucket;
		merged.set(issue.key, {
			...existing,
			planning: {
				contextId: existing.planning.contextId,
				iterationIds: [
					...new Set([...existing.planning.iterationIds, ...issue.planning.iterationIds]),
				],
				bucket,
			},
		});
	}
	return [...merged.values()];
}

function jiraErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

function jiraProjectSnapshot(
	projectKey: string,
	issues: JiraIssue[]
): Omit<JiraPlanningSnapshot, "failures"> {
	return {
		issues,
		contexts: [
			{
				id: `jira-project:${projectKey}`,
				provider: "jira",
				groupId: projectKey,
				name: projectKey,
				kind: "board",
				supportsIterations: false,
				selected: true,
			},
		],
		iterations: [],
	};
}

async function getProjectPlanningSnapshotForProject(
	projectKey: string,
	projectIssues: JiraIssue[],
	selectedBoardId: string | null,
	selectedIterationId?: string
): Promise<Omit<JiraPlanningSnapshot, "failures">> {
	// Keep the pre-planning Jira/JQL fetch as the source of truth. Agile board
	// calls only enrich this stable project snapshot with board/sprint placement.
	// That way a board permission or metadata failure can never empty tickets that
	// the existing Jira integration already fetched successfully.
	const boards = await getBoardsForProject(projectKey);
	const selectedBoard = boards.find((board) => board.id === selectedBoardId) ?? boards[0];
	if (!selectedBoard) {
		return jiraProjectSnapshot(projectKey, projectIssues);
	}

	const contextId = selectedBoard.id;
	const [columns, sprints] = await Promise.all([
		getBoardColumns(contextId),
		selectedBoard.type === "scrum" ? getBoardSprints(contextId) : Promise.resolve([]),
	]);
	const backlogIssues = await fetchAgileIssues(`/rest/software/1.0/board/${contextId}/backlog`, {
		contextId,
		iterationIds: [],
		bucket: "backlog",
	});
	const requests: Array<Promise<JiraIssue[]>> = [];
	if (selectedBoard.type === "scrum") {
		for (const sprint of sprints) {
			if (
				sprint.state !== "active" &&
				sprint.state !== "future" &&
				sprint.id !== selectedIterationId
			) {
				continue;
			}
			requests.push(
				fetchAgileIssues(`/rest/software/1.0/board/${contextId}/sprint/${sprint.id}/issue`, {
					contextId,
					iterationIds: [sprint.id],
					bucket: sprint.state,
				})
			);
		}
	} else {
		requests.push(
			fetchAgileIssues(`/rest/software/1.0/board/${contextId}/issue`, {
				contextId,
				iterationIds: [],
				bucket: "active",
			})
		);
	}

	const currentIssues = mergeJiraPlanningIssues(await Promise.all(requests));
	const backlogKeys = new Set(backlogIssues.map((issue) => issue.key));
	const planningIssues = mergeJiraPlanningIssues([
		backlogIssues,
		currentIssues.filter((issue) => selectedBoard.type === "scrum" || !backlogKeys.has(issue.key)),
	]);
	return {
		issues: mergeJiraPlanningIssues([projectIssues, planningIssues]),
		contexts: boards.map((board) => ({
			id: board.id,
			provider: "jira" as const,
			groupId: projectKey,
			name: board.name,
			kind: "board" as const,
			supportsIterations: board.type === "scrum",
			selected: board.id === selectedBoard.id,
			boardType: board.type,
			columns: board.id === selectedBoard.id ? columns : undefined,
		})),
		iterations: sprints.map((sprint) => ({
			id: sprint.id,
			provider: "jira" as const,
			contextId: selectedBoard.id,
			groupId: projectKey,
			name: sprint.name,
			state: sprint.state,
			startAt: sprint.startAt,
			endAt: sprint.endAt,
		})),
	};
}

export async function getProjectPlanningSnapshot(
	projectKeys: string[],
	issues: JiraIssue[],
	selectedBoardByProject: Record<string, string | null>,
	selectedIterationId?: string
): Promise<JiraPlanningSnapshot> {
	assertValidProjectKeys(projectKeys);
	const results = await Promise.all(
		projectKeys.map(async (projectKey) => {
			const projectIssues = issues.filter((issue) => issue.projectKey === projectKey);
			try {
				return {
					projectKey,
					snapshot: await getProjectPlanningSnapshotForProject(
						projectKey,
						projectIssues,
						selectedBoardByProject[projectKey] ?? null,
						selectedIterationId
					),
					message: null,
				};
			} catch (error) {
				return {
					projectKey,
					snapshot: jiraProjectSnapshot(projectKey, projectIssues),
					message: jiraErrorMessage(error),
				};
			}
		})
	);

	return {
		issues: mergeJiraPlanningIssues(results.map((result) => result.snapshot.issues)),
		contexts: results.flatMap((result) => result.snapshot.contexts),
		iterations: results.flatMap((result) => result.snapshot.iterations),
		failures: results.flatMap((result) =>
			result.message ? [{ projectKey: result.projectKey, message: result.message }] : []
		),
	};
}

export interface JiraProject {
	key: string;
	name: string;
}

export async function getProjects(): Promise<JiraProject[]> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const projects: JiraProject[] = [];
	let startAt = 0;
	let isLast = false;

	while (!isLast) {
		const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/project/search?startAt=${startAt}&maxResults=50`;
		const res = await atlassianFetch("jira", url);
		if (!res.ok) {
			throw new Error(`Jira project search failed: ${res.status} ${await res.text()}`);
		}
		const data = (await res.json()) as {
			values: Array<{ key: string; name: string }>;
			isLast?: boolean;
			total?: number;
			maxResults?: number;
		};
		projects.push(...data.values.map((p) => ({ key: p.key, name: p.name })));
		if (data.isLast === true || data.values.length === 0) {
			isLast = true;
		} else {
			startAt += data.values.length;
			if (typeof data.total === "number" && startAt >= data.total) isLast = true;
		}
	}

	return projects;
}

export async function updateIssueAssignee(
	issueKey: string,
	accountId: string | null
): Promise<void> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return;

	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}/assignee`;
	const res = await atlassianFetch("jira", url, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ accountId }),
	});

	if (!res.ok) {
		throw new Error(`Jira assignee update failed: ${res.status} ${await res.text()}`);
	}
}

export async function getIssueTransitions(issueKey: string): Promise<TicketStatus[]> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return [];

	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/issue/${issueKey}/transitions`;

	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira transitions fetch failed: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as {
		transitions: Array<{
			id: string;
			name: string;
			to: { id: string; name: string; statusCategory: { key: string } };
		}>;
	};

	return data.transitions.map((t) => ({
		id: t.id,
		name: t.name,
		color: mapStatusToColor(t.to.statusCategory.key),
		categoryKey: t.to.statusCategory.key,
		targetStatusId: t.to.id,
		targetStatusName: t.to.name,
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

export interface JiraIssueDetail {
	description: string;
	comments: Array<{
		id: string;
		author: string;
		avatarUrl?: string;
		body: string;
		createdAt: string;
	}>;
}

export async function getIssueDetail(issueKey: string): Promise<JiraIssueDetail> {
	const auth = getAuth("jira");
	if (!auth || !auth.cloudId) return { description: "", comments: [] };

	const url = `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=description,comment`;

	const res = await atlassianFetch("jira", url);
	if (!res.ok) {
		throw new Error(`Jira issue detail fetch failed: ${res.status} ${await res.text()}`);
	}

	const data = (await res.json()) as {
		fields: {
			description: { content?: Array<{ content?: Array<{ text?: string }> }> } | string | null;
			comment?: {
				comments: Array<{
					id: string;
					author: { displayName: string; avatarUrls?: Record<string, string> };
					body: { content?: Array<{ content?: Array<{ text?: string }> }> } | string;
					created: string;
				}>;
			};
		};
	};

	const extractText = (adf: unknown): string => {
		if (typeof adf === "string") return adf;
		if (!adf || typeof adf !== "object") return "";
		const node = adf as { text?: string; content?: unknown[] };
		if (node.text) return node.text;
		if (Array.isArray(node.content)) {
			return node.content.map(extractText).join("\n");
		}
		return "";
	};

	const description = extractText(data.fields.description);
	const comments = (data.fields.comment?.comments ?? []).map((c) => ({
		id: c.id,
		author: c.author.displayName,
		avatarUrl: c.author.avatarUrls?.["24x24"],
		body: extractText(c.body),
		createdAt: c.created,
	}));

	return { description, comments };
}
