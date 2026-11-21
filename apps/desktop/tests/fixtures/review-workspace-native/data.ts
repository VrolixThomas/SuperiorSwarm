import type { GitHubPRDetails, PRContext } from "../../../src/shared/github-types";
export const prCtx: PRContext = {
	provider: "github",
	owner: "fixture",
	repo: "repo",
	number: 1,
	title: "Native reading workspace validation",
	sourceBranch: "change",
	targetBranch: "main",
	repoPath: "/not-live",
};
export const files = [
	"src/alpha.ts",
	"src/beta.ts",
	"binary.dat",
	"empty.txt",
	...Array.from({ length: 102 }, (_, i) => `many/file-${String(i).padStart(3, "0")}.ts`),
];
export const settings = {
	autoMapOnReviewRequest: false,
	alsoReview: true,
	defaultRailMode: "auto",
};
export function details(head: string, base: string): GitHubPRDetails {
	return {
		title: prCtx.title,
		body: "Disposable PR: controlled provider metadata, real immutable Git contents.",
		state: "OPEN",
		isDraft: false,
		author: "someone",
		authorAvatarUrl: "",
		reviewDecision: null,
		ciState: null,
		checks: [],
		reviewers: [],
		conversationComments: [],
		sourceBranch: "change",
		targetBranch: "main",
		headCommitOid: head,
		baseCommitOid: base,
		filesComplete: true,
		files: files.map((path) => ({ path, additions: 2, deletions: 2, changeType: "MODIFIED" })),
		reviewThreads: [
			{
				id: "left",
				path: "src/alpha.ts",
				line: 2,
				diffSide: "LEFT",
				isResolved: false,
				resolutionKnown: true,
				comments: [
					{
						id: "c1",
						body: "Left-side reviewer thread",
						author: "same-name",
						authorId: "42",
						authorAvatarUrl: "",
						createdAt: "",
					},
				],
			},
			{
				id: "right",
				path: "src/alpha.ts",
				line: 3,
				diffSide: "RIGHT",
				isResolved: false,
				resolutionKnown: true,
				comments: [
					{
						id: "c2",
						body: "Right-side reviewer thread",
						author: "same-name",
						authorId: "99",
						authorAvatarUrl: "",
						createdAt: "",
					},
				],
			},
			{
				id: "outdated",
				path: "src/alpha.ts",
				line: null,
				originalLine: 9,
				isOutdated: true,
				diffSide: "LEFT",
				isResolved: false,
				resolutionKnown: true,
				comments: [
					{
						id: "c3",
						body: "Earlier revision thread",
						author: "other",
						authorAvatarUrl: "",
						createdAt: "",
					},
				],
			},
			{
				id: "unknown",
				path: "src/alpha.ts",
				line: 4,
				diffSide: "RIGHT",
				isResolved: false,
				resolutionKnown: false,
				comments: [
					{
						id: "c4",
						body: "Unknown resolution thread",
						author: "other",
						authorAvatarUrl: "",
						createdAt: "",
					},
				],
			},
		],
	};
}
export function mappedPath(head: string, status = "ready") {
	return {
		id: "path",
		prKey: "fixture/repo#1",
		headSha: head,
		agent: { id: "codex", label: "Codex" },
		status,
		updatedAt: new Date().toISOString(),
		entries: [
			{
				id: "entry",
				title: "Request flow",
				steps: [
					{
						id: "alpha",
						kind: "changed",
						path: "src/alpha.ts",
						note: "Validate the request before handling it.",
						focus: [{ side: "RIGHT", startLine: 2, endLine: 3 }],
						tests: [{ path: "unchanged.test.ts", changed: false }],
					},
					{
						id: "context",
						kind: "context",
						path: "context.ts",
						note: "Shared configuration",
						focus: [],
						addedBy: "user",
					},
					{
						id: "beta",
						kind: "changed",
						path: "src/beta.ts",
						note: "Apply the validated request.",
						focus: [],
						tests: [],
					},
				],
			},
		],
		otherFiles: files.filter((p) => !p.startsWith("src/")),
	};
}
