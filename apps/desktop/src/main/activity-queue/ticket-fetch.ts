import type {
	TicketQueueAccount,
	TicketQueueComment,
	TicketQueueFact,
} from "../../shared/ticket-queue";
import { atlassianFetch } from "../atlassian/auth";
import { mapApiIssue } from "../atlassian/jira";
import { linearFetch } from "../linear/auth";

// The queue never consumes the Tickets canvas cache: that snapshot can be filtered by sprint/team.
export interface TicketQueueTransport {
	linear(query: string, variables: Record<string, unknown>): Promise<unknown>;
	jira(url: string): Promise<unknown>;
}
export const ticketQueueTransport: TicketQueueTransport = {
	async linear(query, variables) {
		const response = await linearFetch({ query, variables });
		if (!response.ok) throw new Error(`Linear queue fetch failed (${response.status})`);
		const payload = await response.json();
		if (payload.errors?.length || !payload.data)
			throw new Error("Linear queue snapshot incomplete");
		return payload.data;
	},
	async jira(url) {
		const response = await atlassianFetch("jira", url);
		if (!response.ok) throw new Error(`Jira queue fetch failed (${response.status})`);
		return response.json();
	},
};

type LinearNode = {
	id: string;
	identifier: string;
	title: string;
	url: string;
	state: { id: string; name: string; color: string; type: string };
	team: { id: string; name: string };
	assignee: { id: string } | null;
};
type Connection<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
async function linearPages<T>(
	read: (cursor: string | null) => Promise<Connection<T>>
): Promise<T[]> {
	const result: T[] = [];
	const cursors = new Set<string>();
	let cursor: string | null = null;
	for (let page = 0; page < 200; page++) {
		const data = await read(cursor);
		if (!Array.isArray(data?.nodes) || typeof data.pageInfo?.hasNextPage !== "boolean")
			throw new Error("Incomplete Linear page");
		result.push(...data.nodes);
		if (!data.pageInfo.hasNextPage) return result;
		cursor = data.pageInfo.endCursor;
		if (!cursor || cursors.has(cursor)) throw new Error("Incomplete Linear pagination");
		cursors.add(cursor);
	}
	throw new Error("Linear pagination limit reached");
}

export async function fetchTicketQueueFacts(
	account: TicketQueueAccount,
	siteUrl: string | undefined,
	transport = ticketQueueTransport
): Promise<TicketQueueFact[]> {
	if (account.provider === "linear") {
		const nodes = await linearPages<LinearNode>(async (cursor) => {
			const data = (await transport.linear(
				`query QueueAssignedIssues($account: ID!, $cursor: String) {
				issues(first: 100, after: $cursor, filter: { assignee: { id: { eq: $account } }, state: { type: { nin: ["completed", "canceled", "cancelled"] } } }) {
					nodes { id identifier title url state { id name color type } team { id name } assignee { id } }
					pageInfo { hasNextPage endCursor }
				}
			}`,
				{ account: account.accountId, cursor }
			)) as { issues: Connection<LinearNode> };
			return data.issues;
		});
		return nodes.map((node) => ({
			provider: "linear",
			id: node.id,
			identifier: node.identifier,
			title: node.title,
			url: node.url,
			status: { id: node.state.id, name: node.state.name, color: node.state.color },
			groupId: node.team.id,
			groupName: node.team.name,
			assigneeId: node.assignee?.id ?? null,
			state:
				node.state.type === "unstarted"
					? "unstarted"
					: node.state.type === "started"
						? "started"
						: "other",
		}));
	}
	const facts: TicketQueueFact[] = [];
	const tokens = new Set<string>();
	let token: string | undefined;
	for (let page = 0; page < 200; page++) {
		const query = new URLSearchParams({
			jql: "assignee = currentUser() AND statusCategory != Done ORDER BY key ASC",
			fields: "summary,status,priority,issuetype,project,created,updated,assignee",
			maxResults: "100",
		});
		if (token) query.set("nextPageToken", token);
		const data = (await transport.jira(
			`https://api.atlassian.com/ex/jira/${encodeURIComponent(account.siteId)}/rest/api/3/search/jql?${query}`
		)) as { issues: Parameters<typeof mapApiIssue>[0][]; isLast?: boolean; nextPageToken?: string };
		if (!Array.isArray(data.issues)) throw new Error("Incomplete Jira issue snapshot");
		for (const raw of data.issues) {
			const issue = mapApiIssue(
				raw,
				siteUrl ?? `https://api.atlassian.com/ex/jira/${account.siteId}`
			);
			facts.push({
				provider: "jira",
				id: issue.key,
				identifier: issue.key,
				title: issue.summary,
				url: issue.webUrl,
				status: {
					id: issue.statusId ?? issue.status,
					name: issue.status,
					color: issue.statusColor,
				},
				groupId: issue.projectKey,
				groupName: issue.projectKey,
				assigneeId: issue.assigneeId,
				state:
					issue.statusCategory === "new"
						? "unstarted"
						: issue.statusCategory === "indeterminate"
							? "started"
							: issue.statusCategory === "done"
								? "closed"
								: "other",
			});
		}
		if (data.isLast === true) return facts;
		token = data.nextPageToken;
		if (!token || tokens.has(token)) throw new Error("Incomplete Jira pagination");
		tokens.add(token);
	}
	throw new Error("Jira pagination limit reached");
}

function adfText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return "";
	const node = value as { text?: string; content?: unknown[]; attrs?: { text?: string } };
	return (
		node.text ??
		node.attrs?.text ??
		(Array.isArray(node.content) ? node.content.map(adfText).join("\n") : "")
	);
}
function validateComments(comments: TicketQueueComment[]): TicketQueueComment[] {
	if (
		comments.some(
			(comment) =>
				!comment.id || typeof comment.body !== "string" || !Number.isFinite(comment.createdAt)
		)
	)
		throw new Error("Incomplete ticket comment metadata");
	return [...new Map(comments.map((comment) => [comment.id, comment])).values()];
}
export async function fetchTicketQueueComments(
	account: TicketQueueAccount,
	ticketId: string,
	transport = ticketQueueTransport
): Promise<TicketQueueComment[]> {
	if (account.provider === "linear") {
		type Comment = {
			id: string;
			body: string;
			createdAt: string;
			user: { id: string; name: string } | null;
		};
		const comments = await linearPages<Comment>(async (cursor) => {
			const data = (await transport.linear(
				"query QueueTicketComments($id: String!, $cursor: String) { issue(id: $id) { comments(first: 100, after: $cursor) { nodes { id body createdAt user { id name } } pageInfo { hasNextPage endCursor } } } }",
				{ id: ticketId, cursor }
			)) as { issue: { comments: Connection<Comment> } };
			return data.issue.comments;
		});
		return validateComments(
			comments.map((comment) => ({
				id: comment.id,
				authorId: comment.user?.id ?? null,
				author: comment.user?.name ?? "Unknown author",
				body: comment.body.slice(0, 4000),
				createdAt: Date.parse(comment.createdAt),
			}))
		);
	}
	const result: TicketQueueComment[] = [];
	for (let startAt = 0, pages = 0; pages < 200; pages++) {
		const data = (await transport.jira(
			`https://api.atlassian.com/ex/jira/${encodeURIComponent(account.siteId)}/rest/api/3/issue/${encodeURIComponent(ticketId)}/comment?startAt=${startAt}&maxResults=100&orderBy=created`
		)) as {
			total: number;
			startAt: number;
			comments: {
				id: string;
				author?: { accountId?: string; displayName?: string };
				body: unknown;
				created: string;
			}[];
		};
		if (!Array.isArray(data.comments) || !Number.isInteger(data.total) || data.startAt !== startAt)
			throw new Error("Incomplete Jira comment snapshot");
		result.push(
			...data.comments.map((comment) => ({
				id: comment.id,
				authorId: comment.author?.accountId ?? null,
				author: comment.author?.displayName ?? "Unknown author",
				body: adfText(comment.body).slice(0, 4000),
				createdAt: Date.parse(comment.created),
			}))
		);
		startAt += data.comments.length;
		if (startAt >= data.total) return validateComments(result);
		if (!data.comments.length) throw new Error("Incomplete Jira comment pagination");
	}
	throw new Error("Jira comment pagination limit reached");
}
