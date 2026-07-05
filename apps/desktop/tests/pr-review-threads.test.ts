import { describe, expect, test } from "bun:test";
import {
	CONDENSED_TO_FILTERS,
	type DraftLike,
	extractDiffContext,
	fileCommentCounts,
	groupThreadsByFile,
	mapDraftComment,
	matchesFilter,
	pickLatestDraft,
	threadAuthor,
	threadBucket,
	threadCounts,
	threadDate,
	threadExcerpt,
} from "../src/renderer/lib/pr-review-threads";
import type { DiffHunk } from "../src/shared/diff-types";
import type { AIDraftThread, GitHubReviewThread, UnifiedThread } from "../src/shared/github-types";

function aiThread(
	status: AIDraftThread["status"],
	overrides: Partial<AIDraftThread> = {}
): AIDraftThread {
	return {
		id: `ai-${status}`,
		isAIDraft: true,
		draftCommentId: `draft-${status}`,
		path: "src/a.ts",
		line: 1,
		diffSide: "RIGHT",
		body: "AI body",
		status,
		userEdit: null,
		createdAt: "2026-01-02T03:04:05.000Z",
		...overrides,
	};
}

function githubThread(
	isResolved: boolean,
	overrides: Partial<GitHubReviewThread> = {}
): GitHubReviewThread & { isAIDraft?: false } {
	return {
		id: isResolved ? "gh-resolved" : "gh-open",
		isAIDraft: false,
		isResolved,
		path: "src/a.ts",
		line: 1,
		diffSide: "RIGHT",
		comments: [
			{
				id: "comment-1",
				body: "GitHub body",
				author: "octocat",
				authorAvatarUrl: "",
				createdAt: "2026-02-03T04:05:06.000Z",
			},
		],
		...overrides,
	};
}

describe("pr-review-threads", () => {
	test("maps AI draft statuses to review buckets", () => {
		expect(threadBucket(aiThread("pending"))).toBe("pending");
		expect(threadBucket(aiThread("edited"))).toBe("pending");
		expect(threadBucket(aiThread("error"))).toBe("pending");
		expect(threadBucket(aiThread("user-pending"))).toBe("accepted");
		expect(threadBucket(aiThread("approved"))).toBe("accepted");
		expect(threadBucket(aiThread("rejected"))).toBe("declined");
		expect(threadBucket(aiThread("submitted"))).toBe("resolved");
	});

	test("maps GitHub review threads to open or resolved buckets", () => {
		expect(threadBucket(githubThread(false))).toBe("open");
		expect(threadBucket(githubThread(true))).toBe("resolved");
	});

	test("matches filters and counts threads by bucket", () => {
		const threads: UnifiedThread[] = [
			aiThread("pending", { id: "ai-pending" }),
			aiThread("approved", { id: "ai-approved" }),
			aiThread("rejected", { id: "ai-rejected" }),
			githubThread(false, { id: "gh-open" }),
			githubThread(true, { id: "gh-resolved" }),
		];
		const pendingThread = threads[0];
		if (!pendingThread) throw new Error("missing pending thread fixture");

		expect(matchesFilter(pendingThread, "all")).toBe(true);
		expect(matchesFilter(pendingThread, "pending")).toBe(true);
		expect(matchesFilter(pendingThread, "open")).toBe(false);
		expect(CONDENSED_TO_FILTERS.attention).toEqual(["pending", "open"]);
		expect(CONDENSED_TO_FILTERS.done).toEqual(["declined", "resolved"]);
		expect(threadCounts(threads)).toEqual({
			all: 5,
			pending: 1,
			accepted: 1,
			declined: 1,
			open: 1,
			resolved: 1,
		});
	});

	test("maps raw draft comments to AI draft threads", () => {
		const createdAt = new Date("2026-01-02T03:04:05.000Z");

		expect(
			mapDraftComment(
				{
					id: "42",
					filePath: "src/app.ts",
					lineNumber: 7,
					side: null,
					body: "original body",
					status: "pending",
					userEdit: "edited body",
					createdAt,
					resolution: "resolved-by-code",
				},
				3
			)
		).toEqual({
			id: "ai-42",
			isAIDraft: true,
			draftCommentId: "42",
			path: "src/app.ts",
			line: 7,
			diffSide: "RIGHT",
			body: "original body",
			status: "pending",
			userEdit: "edited body",
			createdAt: "2026-01-02T03:04:05.000Z",
			resolution: "resolved-by-code",
			roundNumber: 3,
		});
	});

	test("maps draft comment LEFT side and normalizes unknown statuses to pending", () => {
		expect(
			mapDraftComment({
				id: "left-side",
				filePath: "src/app.ts",
				lineNumber: 9,
				side: "LEFT",
				body: "left body",
				status: "unexpected-status",
				createdAt: "2026-01-02T03:04:05.000Z",
			})
		).toMatchObject({
			id: "ai-left-side",
			draftCommentId: "left-side",
			diffSide: "LEFT",
			status: "pending",
		});
	});

	test("picks the latest draft by PR, status priority, and round number", () => {
		const drafts: DraftLike[] = [
			{ id: "wrong-pr", prIdentifier: "github:other/repo#1", status: "ready", roundNumber: 99 },
			{ id: "queued-high", prIdentifier: "github:org/repo#1", status: "queued", roundNumber: 20 },
			{
				id: "in-progress",
				prIdentifier: "github:org/repo#1",
				status: "in_progress",
				roundNumber: 10,
			},
			{ id: "ready-low", prIdentifier: "github:org/repo#1", status: "ready", roundNumber: 1 },
			{ id: "ready-high", prIdentifier: "github:org/repo#1", status: "ready", roundNumber: 2 },
			{ id: "unknown", prIdentifier: "github:org/repo#1", status: "mystery", roundNumber: 999 },
		];

		expect(pickLatestDraft(drafts, "github:org/repo#1")?.id).toBe("ready-high");
	});

	test("returns undefined when no matching draft exists", () => {
		expect(pickLatestDraft(undefined, "github:org/repo#1")).toBeUndefined();
		expect(pickLatestDraft([], "github:org/repo#1")).toBeUndefined();
		expect(
			pickLatestDraft(
				[{ id: "wrong-pr", prIdentifier: "github:other/repo#1", status: "ready" }],
				"github:org/repo#1"
			)
		).toBeUndefined();
	});

	test("groups threads by file order and sorts threads within each file by line", () => {
		const groups = groupThreadsByFile(
			[
				aiThread("pending", { id: "z-5", path: "z.ts", line: 5 }),
				aiThread("pending", { id: "a-10", path: "a.ts", line: 10 }),
				aiThread("pending", { id: "b-3", path: "b.ts", line: 3 }),
				aiThread("pending", { id: "a-null", path: "a.ts", line: null }),
				aiThread("pending", { id: "a-2", path: "a.ts", line: 2 }),
				aiThread("pending", { id: "m-1", path: "m.ts", line: 1 }),
			],
			["b.ts", "a.ts"]
		);

		expect(groups.map((g) => g.path)).toEqual(["b.ts", "a.ts", "m.ts", "z.ts"]);
		expect(groups.at(1)?.threads.map((t) => t.id)).toEqual(["a-null", "a-2", "a-10"]);
	});

	test("counts active comments by file without resolved provider threads", () => {
		const counts = fileCommentCounts([
			githubThread(false, { id: "open-gh", path: "src/a.ts" }),
			githubThread(true, { id: "resolved-gh", path: "src/a.ts" }),
			aiThread("pending", { id: "draft-pending", path: "src/a.ts" }),
			aiThread("user-pending", { id: "draft-accepted", path: "src/b.ts" }),
		]);

		expect(counts.get("src/a.ts")).toBe(2);
		expect(counts.get("src/b.ts")).toBe(1);
		expect(counts.has("missing.ts")).toBe(false);
	});

	test("reads thread author and date from the thread source", () => {
		expect(threadAuthor(aiThread("pending"))).toBe("SuperiorSwarm AI");
		expect(threadDate(aiThread("pending"))).toBe("2026-01-02T03:04:05.000Z");
		expect(threadAuthor(githubThread(false))).toBe("octocat");
		expect(threadDate(githubThread(false))).toBe("2026-02-03T04:05:06.000Z");
		expect(threadAuthor(githubThread(false, { comments: [] }))).toBe("Unknown");
		expect(threadDate(githubThread(false, { comments: [] }))).toBe("");
	});

	test("returns first-line excerpts from AI and GitHub threads", () => {
		expect(threadExcerpt(aiThread("pending", { body: "First AI line\nSecond AI line" }))).toBe(
			"First AI line"
		);
		expect(
			threadExcerpt(
				aiThread("pending", {
					body: "Original line",
					userEdit: "Edited first line\nEdited second line",
				})
			)
		).toBe("Edited first line");
		expect(
			threadExcerpt(
				githubThread(false, {
					comments: [
						{
							id: "comment-1",
							body: "First GitHub line\nSecond GitHub line",
							author: "octocat",
							authorAvatarUrl: "",
							createdAt: "2026-02-03T04:05:06.000Z",
						},
					],
				})
			)
		).toBe("First GitHub line");
	});

	test("extracts a clipped diff context window around a modified-side line", () => {
		const hunks: DiffHunk[] = [
			{
				header: "@@ -10,5 +10,5 @@",
				oldStart: 10,
				oldLines: 5,
				newStart: 10,
				newLines: 5,
				lines: [
					{ type: "context", content: "line 10", oldLineNumber: 10, newLineNumber: 10 },
					{ type: "removed", content: "old line 11", oldLineNumber: 11 },
					{ type: "added", content: "new line 11", newLineNumber: 11 },
					{ type: "context", content: "line 12", oldLineNumber: 12, newLineNumber: 12 },
					{ type: "context", content: "line 13", oldLineNumber: 13, newLineNumber: 13 },
				],
			},
			{
				header: "@@ -30,1 +30,1 @@",
				oldStart: 30,
				oldLines: 1,
				newStart: 30,
				newLines: 1,
				lines: [{ type: "context", content: "line 30", oldLineNumber: 30, newLineNumber: 30 }],
			},
		];

		expect(extractDiffContext(hunks, 11, 1).map((line) => line.content)).toEqual([
			"old line 11",
			"new line 11",
			"line 12",
		]);
		expect(extractDiffContext(hunks, 99)).toEqual([]);
	});
});
