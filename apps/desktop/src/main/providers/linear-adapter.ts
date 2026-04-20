import { getAuth } from "../linear/auth";
import {
	getIssueDetail,
	getTeamIssues,
	getTeamIssuesWithDone,
	getTeamStates,
	updateIssueState,
} from "../linear/linear";
import type {
	IssueTracker,
	NormalizedIssue,
	NormalizedIssueDetail,
	NormalizedState,
} from "./types";

function mapToNormalizedIssue(issue: {
	id: string;
	identifier: string;
	title: string;
	url: string;
	stateName: string;
	stateType: string;
	stateColor: string;
}): NormalizedIssue {
	return {
		id: issue.id ?? "",
		identifier: issue.identifier ?? "",
		title: issue.title ?? "",
		url: issue.url ?? "",
		status: issue.stateName ?? "",
		statusCategory: issue.stateType ?? "",
		statusColor: issue.stateColor ?? "#808080",
	};
}

export class LinearAdapter implements IssueTracker {
	readonly name = "linear" as const;

	isConnected(): boolean {
		return getAuth() !== null;
	}

	async getAssignedIssues(options?: {
		includeDone?: boolean;
		teamId?: string;
	}): Promise<NormalizedIssue[]> {
		if (!this.isConnected()) return [];

		const teamId = options?.teamId;
		const issues = options?.includeDone
			? await getTeamIssuesWithDone(teamId)
			: await getTeamIssues(teamId);

		return issues.map(mapToNormalizedIssue);
	}

	async getIssueDetail(issueId: string): Promise<NormalizedIssueDetail> {
		const detail = await getIssueDetail(issueId);
		return {
			description: detail.description ?? "",
			comments: (detail.comments ?? []).map((c) => ({
				id: c.id,
				author: c.author ?? "Unknown",
				avatarUrl: c.avatarUrl ?? undefined,
				body: c.body,
				createdAt: c.createdAt,
			})),
		};
	}

	async getAvailableStates(context: {
		issueId?: string;
		teamId?: string;
	}): Promise<NormalizedState[]> {
		if (!context.teamId) return [];

		const states = await getTeamStates(context.teamId);
		return states.map((s) => ({
			id: s.id,
			name: s.name,
		}));
	}

	async updateIssueState(issueId: string, stateId: string): Promise<void> {
		await updateIssueState(issueId, stateId);
	}
}
