// Mirrors apps/desktop/src/renderer/components/PullRequestsTab.tsx connected-list render path.

import { PullRequestGroup } from "./PullRequestGroup";
import type { GitHubPREnriched, MergedPR } from "./PullRequestItem";

interface MockPR {
	id: string;
	number: number;
	title: string;
	repoDisplay: string;
	reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | null;
	commentCount: number;
	isDraft: boolean;
	state: "open" | "merged" | "closed";
	sourceBranch: string;
	targetBranch: string;
	author: string;
	reviewers: Array<{
		login: string;
		decision: "APPROVED" | "CHANGES_REQUESTED" | "PENDING" | "COMMENTED" | "DISMISSED" | null;
	}>;
	ciState?: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
	mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | null;
	isActive: boolean;
	reviewStatus: { status: string; commentCount: number; roundNumber: number } | null;
}

const MOCK_PRS: MockPR[] = [
	{
		id: "1",
		number: 214,
		title: "feat: agent terminal chat",
		repoDisplay: "superiorswarm",
		reviewDecision: "CHANGES_REQUESTED",
		commentCount: 3,
		isDraft: false,
		state: "open",
		sourceBranch: "feat/agent-terminal-chat",
		targetBranch: "main",
		author: "alex",
		reviewers: [
			{ login: "sam", decision: "CHANGES_REQUESTED" },
			{ login: "jordan", decision: "PENDING" },
		],
		ciState: "FAILURE",
		mergeable: "MERGEABLE",
		isActive: true,
		reviewStatus: { status: "ready", commentCount: 3, roundNumber: 1 },
	},
	{
		id: "2",
		number: 211,
		title: "fix: dedupe agent events stream",
		repoDisplay: "superiorswarm",
		reviewDecision: "APPROVED",
		commentCount: 1,
		isDraft: false,
		state: "open",
		sourceBranch: "fix/dedupe-agent-events",
		targetBranch: "main",
		author: "sam",
		reviewers: [{ login: "alex", decision: "APPROVED" }],
		isActive: false,
		reviewStatus: null,
	},
	{
		id: "3",
		number: 209,
		title: "chore: bump remotion to 4.0.218",
		repoDisplay: "superiorswarm",
		reviewDecision: null,
		commentCount: 0,
		isDraft: true,
		state: "open",
		sourceBranch: "chore/bump-remotion-4.0.218",
		targetBranch: "main",
		author: "jordan",
		reviewers: [],
		isActive: false,
		reviewStatus: null,
	},
];

const REPO_OWNER = "superiorswarm";
const REPO_NAME = "superiorswarm";
const REPO_KEY = `${REPO_OWNER}/${REPO_NAME}`;

export function PullRequestsTab() {
	const prs: MergedPR[] = MOCK_PRS.map((p) => ({
		provider: "github",
		id: p.id,
		number: p.number,
		title: p.title,
		state: p.state,
		isDraft: p.isDraft,
		repoDisplay: `${REPO_KEY}`,
		reviewDecision: p.reviewDecision,
		commentCount: p.commentCount,
		sourceBranch: p.sourceBranch,
		targetBranch: p.targetBranch,
	}));

	const enrichmentMap = new Map<string, GitHubPREnriched>();
	for (const p of MOCK_PRS) {
		const identifier = `${REPO_KEY}#${p.number}`;
		enrichmentMap.set(identifier, {
			author: p.author,
			reviewers: p.reviewers,
			ciState: p.ciState,
			mergeable: p.mergeable,
		});
	}

	const reviewDraftMap = new Map<
		string,
		{ status: string; commentCount: number; roundNumber: number }
	>();
	for (const p of MOCK_PRS) {
		if (p.reviewStatus) {
			reviewDraftMap.set(`${REPO_KEY}#${p.number}`, p.reviewStatus);
		}
	}

	const activePR = MOCK_PRS.find((p) => p.isActive);
	const activePRIdentifier = activePR ? `${REPO_KEY}#${activePR.number}` : null;

	const getPrIdentifier = (pr: MergedPR): string => `${REPO_KEY}#${pr.number}`;

	return (
		<div className="flex flex-col gap-2 px-2 pt-2 overflow-y-auto">
			<PullRequestGroup
				owner={REPO_OWNER}
				repo={REPO_NAME}
				displayName={REPO_NAME}
				prs={prs}
				isCollapsed={false}
				activePRIdentifier={activePRIdentifier}
				getPrIdentifier={getPrIdentifier}
				enrichmentMap={enrichmentMap}
				reviewDraftMap={reviewDraftMap}
			/>
		</div>
	);
}
