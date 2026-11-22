import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "manual comment revision provenance")) {
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const { aiReviewRouter } = await import("../src/main/trpc/routers/ai-review");
	const { makeTestDb } = await import("./test-db");
	test("manual comments retain exact revision and side without repinning old or legacy drafts", async () => {
		const db = makeTestDb();
		_setDbForTesting(db);
		try {
			const caller = aiReviewRouter.createCaller({});
			const input = {
				prProvider: "github" as const,
				prIdentifier: "o/r#1",
				prTitle: "PR",
				filePath: "a.ts",
				lineNumber: 12,
				side: "LEFT" as const,
				body: "Comment",
			};
			const legacy = await caller.addUserComment(input);
			const a = await caller.addUserComment({ ...input, commitSha: "a".repeat(40) });
			const b = await caller.addUserComment({ ...input, commitSha: "b".repeat(40) });
			const second = await caller.addUserComment({ ...input, commitSha: "b".repeat(40) });
			expect(new Set([legacy.reviewDraftId, a.reviewDraftId, b.reviewDraftId]).size).toBe(3);
			expect(second.reviewDraftId).toBe(b.reviewDraftId);
			expect(legacy.commitSha).toBeNull();
			expect(a.commitSha).toBe("a".repeat(40));
			expect(b.commitSha).toBe("b".repeat(40));
			expect(
				db
					.select()
					.from(schema.draftComments)
					.all()
					.every((comment) => comment.side === "LEFT" && comment.lineNumber === 12)
			).toBe(true);
			await expect(caller.addUserComment({ ...input, commitSha: "HEAD" })).rejects.toThrow();
			expect(db.select().from(schema.draftComments).all()).toHaveLength(4);
		} finally {
			_setDbForTesting(null);
		}
	});
}
