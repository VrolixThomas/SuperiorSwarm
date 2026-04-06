import { getAuth } from "../atlassian/auth";
import {
	type JiraIssue,
	type JiraIssueDetail,
	getIssueDetail,
	getIssueTransitions,
	getMyIssues,
	getMyIssuesWithDone,
	updateIssueStatus,
} from "../atlassian/jira";
import type {
	IssueTracker,
	NormalizedIssue,
	NormalizedIssueDetail,
	NormalizedState,
} from "./types";

// ── Pure mapping helpers (exported for testing) ───────────────────────────────

export function mapJiraIssue(issue: JiraIssue): NormalizedIssue {
	return {
		id: issue.key ?? "",
		identifier: issue.key ?? "",
		title: issue.summary ?? "",
		url: issue.webUrl ?? "",
		status: issue.status ?? "",
		statusCategory: issue.statusCategory ?? "",
		statusColor: issue.statusColor || "#808080",
	};
}

export function mapJiraIssueDetail(detail: JiraIssueDetail): NormalizedIssueDetail {
	return {
		description: detail.description ?? "",
		comments: detail.comments.map((c) => ({
			id: c.id,
			author: c.author ?? "",
			avatarUrl: c.avatarUrl,
			body: c.body ?? "",
			createdAt: c.createdAt,
		})),
	};
}

// ── JiraAdapter ───────────────────────────────────────────────────────────────

export class JiraAdapter implements IssueTracker {
	readonly name = "jira" as const;

	isConnected(): boolean {
		const auth = getAuth("jira");
		return auth !== null && Boolean(auth.cloudId);
	}

	async getAssignedIssues(options?: {
		includeDone?: boolean;
		teamId?: string;
	}): Promise<NormalizedIssue[]> {
		if (!this.isConnected()) return [];

		const issues = options?.includeDone ? await getMyIssuesWithDone(30) : await getMyIssues();

		return issues.map(mapJiraIssue);
	}

	async getIssueDetail(issueId: string): Promise<NormalizedIssueDetail> {
		const detail = await getIssueDetail(issueId);
		return mapJiraIssueDetail(detail);
	}

	async getAvailableStates(context: {
		issueId?: string;
		teamId?: string;
	}): Promise<NormalizedState[]> {
		if (!context.issueId) return [];

		const transitions = await getIssueTransitions(context.issueId);
		return transitions.map((t) => ({ id: t.id, name: t.name }));
	}

	async updateIssueState(issueId: string, stateId: string): Promise<void> {
		await updateIssueStatus(issueId, stateId);
	}
}
