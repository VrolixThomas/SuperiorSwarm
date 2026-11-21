import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "publisher provenance preflight")) {
	const { publishReview } = await import("../src/main/ai-review/review-publisher");
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const { registerGitProvider } = await import("../src/main/providers/git-provider");
	const { makeTestDb } = await import("./test-db");
	const head = "a".repeat(40);
	const newHead = "b".repeat(40);
	for (const scenario of [
		"stale",
		"head-drift",
		"unpinned",
		"metadata-error",
		"missing-file",
		"current-left",
		"partial-retry",
		"body-only",
		"verdict-only",
	] as const) {
		test(`${scenario}: preflight preserves accepted comments and exact anchors`, async () => {
			const db = makeTestDb();
			_setDbForTesting(db);
			const writes: import("../src/main/providers/types").CreateCommentParams[] = [];
			const verdicts: import("../src/main/providers/types").SubmitReviewParams[] = [];
			let replies = 0;
			let stateReads = 0;
			let rejectSecond = scenario === "partial-retry";
			const onlySummary = scenario === "body-only" || scenario === "verdict-only";
			registerGitProvider({
				name: "provenance-test",
				getPRState: async () => {
					if (scenario === "metadata-error") throw Error("metadata unavailable");
					return {
						headSha:
							scenario === "stale" || (scenario === "head-drift" && stateReads++ > 0)
								? newHead
								: head,
						state: "open",
					};
				},
				getPRFiles: async () =>
					scenario === "missing-file"
						? []
						: [
								{ path: "new.ts", previousPath: "old.ts", status: "renamed" },
								{ path: "second.ts", status: "modified" },
							],
				createInlineComment: async (
					input: import("../src/main/providers/types").CreateCommentParams
				) => {
					if (input.filePath === "second.ts" && rejectSecond) throw Error("position rejected");
					writes.push(input);
					return { id: String(writes.length) };
				},
				submitReview: async (input: import("../src/main/providers/types").SubmitReviewParams) => {
					verdicts.push(input);
				},
				replyToComment: async () => {
					replies++;
					return { id: "reply" };
				},
				resolveComment: async () => {
					replies++;
				},
			} as unknown as import("../src/main/providers/types").GitProvider);
			try {
				const now = new Date();
				db.insert(schema.reviewDrafts)
					.values({
						id: "draft",
						prProvider: "provenance-test",
						prIdentifier: "o/r#1",
						prTitle: "PR",
						prAuthor: "author",
						sourceBranch: "feature",
						targetBranch: "main",
						status: "ready",
						commitSha: scenario === "unpinned" || onlySummary ? null : head,
						summaryMarkdown: scenario === "body-only" ? "Summary" : null,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				if (!onlySummary) {
					db.insert(schema.draftComments)
						.values({
							id: "first",
							reviewDraftId: "draft",
							filePath: "old.ts",
							lineNumber: 12,
							side: "LEFT",
							body: "Accepted",
							status: "approved",
							createdAt: now,
						})
						.run();
					if (scenario === "partial-retry")
						db.insert(schema.draftComments)
							.values({
								id: "second",
								reviewDraftId: "draft",
								filePath: "second.ts",
								lineNumber: 3,
								side: "RIGHT",
								body: "Second",
								status: "user-pending",
								createdAt: now,
							})
							.run();
					// Known stale input must prevent replies/resolutions and verdict as well as inline writes.
					if (scenario === "stale") {
						db.insert(schema.draftComments)
							.values({
								id: "original",
								reviewDraftId: "draft",
								filePath: "old.ts",
								body: "Old",
								status: "submitted",
								platformCommentId: "thread",
								createdAt: now,
							})
							.run();
						db.insert(schema.draftComments)
							.values({
								id: "resolution",
								reviewDraftId: "draft",
								filePath: "old.ts",
								body: "Resolved",
								status: "approved",
								resolution: "resolved-by-code",
								previousCommentId: "original",
								createdAt: now,
							})
							.run();
					}
				}
				const result = await publishReview("draft", "APPROVE");
				if (
					["stale", "head-drift", "unpinned", "metadata-error", "missing-file"].includes(scenario)
				) {
					expect(result.success).toBe(false);
					expect(result.errors.length).toBeGreaterThan(0);
					expect(writes).toEqual([]);
					expect(verdicts).toEqual([]);
					expect(replies).toBe(0);
					expect(
						db
							.select()
							.from(schema.draftComments)
							.all()
							.find((row) => row.id === "first")?.status
					).toBe("approved");
				} else if (scenario === "partial-retry") {
					expect(result).toMatchObject({ success: false, postedCount: 1, failedCount: 1 });
					expect(verdicts).toEqual([]);
					rejectSecond = false;
					expect(await publishReview("draft", "APPROVE")).toMatchObject({
						success: true,
						postedCount: 1,
					});
					expect(writes.map((write) => write.filePath)).toEqual(["old.ts", "second.ts"]);
					expect(verdicts).toHaveLength(1);
				} else {
					expect(result.success).toBe(true);
					expect(verdicts).toHaveLength(1);
					if (onlySummary) expect(writes).toEqual([]);
					else
						expect(writes[0]).toMatchObject({
							commitId: head,
							filePath: "old.ts",
							side: "LEFT",
							line: 12,
						});
				}
			} finally {
				_setDbForTesting(null);
			}
		});
	}
}
