import type { GitHubPRFile } from "../../shared/github-types";
import type { AskMessage, ChangedFileStep, ReviewPath } from "../../shared/review-path-types";

const root = "apps/desktop/";
const renderer = `${root}src/renderer/`;
const changed = (
	id: string,
	path: string,
	note: string,
	tests: string[] = [],
	focus: [number, number] = [1, 1]
): ChangedFileStep => ({
	id,
	kind: "changed",
	path,
	note,
	focus: [{ side: "RIGHT", startLine: focus[0], endLine: focus[1] }],
	tests: tests.map((path) => ({ path: `${root}tests/${path}`, changed: true })),
});
export const PR129_THREAD_NOTES: NonNullable<ReviewPath["threadNotes"]> = {
	"thread-verdict": {
		verdict: "addressed",
		text: "Looks addressed: the selected verdict is now passed through to the publisher.",
		refs: [
			{
				path: `${renderer}lib/pr-review-submit.ts`,
				line: 9,
				description: "Verdict passed to submission",
			},
		],
	},
};
export const PR129_PATH: ReviewPath = {
	id: "fixture-pr129",
	prKey: "fixture/SuperiorSwarm#129",
	headSha: "fixture-pr129-head",
	agent: { id: "claude", label: "Claude Code" },
	status: "ready",
	reviewed: { findings: 2 },
	updatedAt: "2026-11-21T12:00:00.000Z",
	entries: [
		{
			id: "submit",
			title: "Submit a review",
			steps: [
				changed(
					"submit-popover",
					`${renderer}components/review-mode/SubmitReviewPopover.tsx`,
					"Choose a verdict and submit the accepted comments together."
				),
				changed(
					"submit",
					`${renderer}lib/pr-review-submit.ts`,
					"Build the submission with the selected verdict.",
					["pr-review-submit.test.ts"]
				),
				changed(
					"ai-review",
					`${root}src/main/trpc/routers/ai-review.ts`,
					"Crosses into the main process: saves your summary, then hands off to the publisher. Worth a look: an empty body now clears the AI summary (lines 385–393).",
					[],
					[385, 393]
				),
				changed(
					"publisher",
					`${root}src/main/ai-review/review-publisher.ts`,
					"Publish accepted comments and the verdict in one provider review.",
					["review-publisher.test.ts"],
					[115, 119]
				),
				{
					id: "provider-context",
					kind: "context",
					path: `${root}src/main/providers/git-provider.ts`,
					note: "The provider contract defines the review submission shared by GitHub and Bitbucket.",
					focus: [{ side: "RIGHT", startLine: 9, endLine: 13 }],
					addedBy: "agent",
					usedBy: [
						{
							path: `${root}src/main/ai-review/review-publisher.ts`,
							line: 115,
							description: "Publishes the review through this contract",
						},
					],
				},
			],
		},
		{
			id: "open",
			title: "Open a PR for review",
			steps: [
				changed(
					"pr-list",
					`${renderer}components/GitHubPRList.tsx`,
					"Open the selected PR in its review workspace."
				),
				changed(
					"navigation",
					`${renderer}lib/pr-review-nav.ts`,
					"Navigate to a file without losing the review session."
				),
				changed(
					"tabs",
					`${renderer}stores/tab-store.ts`,
					"Activate the shared review tab for this workspace.",
					["tab-store.test.ts"]
				),
				changed(
					"review-mode",
					`${renderer}stores/review-mode-store.ts`,
					"Keep review navigation and overlay state together.",
					["review-mode-store.test.ts", "review-mode-nav.test.ts"]
				),
			],
		},
	],
	otherFiles: [
		"CLAUDE.md",
		"bun.lock",
		`${renderer}styles.css`,
		"docs/superpowers/plans/2026-07-05-review-mode-redesign.md",
	],
	threadNotes: PR129_THREAD_NOTES,
};
export const PR129_FILES: GitHubPRFile[] = [
	...PR129_PATH.entries.flatMap((entry) =>
		entry.steps.flatMap((step) =>
			step.kind === "changed" ? [step.path, ...step.tests.map((test) => test.path)] : []
		)
	),
	...PR129_PATH.otherFiles,
].map((path) => ({ path, additions: 12, deletions: 3, changeType: "MODIFIED" }));
export const PR129_MAPPING_FRAMES: ReviewPath[] = [1, 2, 4, 6].map((count) => {
	let left = count;
	const entries = PR129_PATH.entries
		.map((entry) => {
			const steps = entry.steps.slice(0, left);
			left = Math.max(0, left - steps.length);
			return { ...entry, steps };
		})
		.filter((entry) => entry.steps.length > 0);
	const placed = entries
		.flatMap((entry) => entry.steps)
		.filter((step) => step.kind === "changed")
		.flatMap((step) => [step.path, ...step.tests.map((test) => test.path)]);
	return {
		...PR129_PATH,
		status: "mapping",
		reviewed: undefined,
		entries,
		otherFiles: PR129_FILES.map((file) => file.path).filter((path) => !placed.includes(path)),
		progress: { placed: placed.length, total: PR129_FILES.length, currentFile: placed.at(-1) },
	};
});
PR129_MAPPING_FRAMES.push(PR129_PATH);
export const PR129_ASK_SAMPLE: AskMessage[] = [
	{
		id: "sample-question",
		role: "user",
		text: "Why is an empty body written as null instead of being skipped?",
		anchor: {
			path: `${root}src/main/trpc/routers/ai-review.ts`,
			side: "RIGHT",
			startLine: 387,
			endLine: 392,
		},
		createdAt: PR129_PATH.updatedAt,
	},
	{
		id: "sample-answer",
		role: "agent",
		text: "Because the popover now always sends `body`. An empty string means “I chose no summary”, so it clears whatever summary the AI draft had. If it were skipped, the publisher would still post the old AI summary as the review body. Leaving `body` out entirely keeps the old behaviour.",
		anchor: {
			path: `${root}src/main/trpc/routers/ai-review.ts`,
			side: "RIGHT",
			startLine: 387,
			endLine: 392,
		},
		refs: [
			{
				path: `${root}src/main/trpc/routers/ai-review.ts`,
				line: 390,
				description: "Empty summary becomes null",
			},
			{
				path: `${root}src/main/ai-review/review-publisher.ts`,
				line: 249,
				description: "Publisher review body",
			},
			{
				path: `${root}src/main/trpc/routers/ai-review.ts`,
				line: 387,
				description: "Omitted body preserves the summary",
			},
		],
		createdAt: PR129_PATH.updatedAt,
	},
];
