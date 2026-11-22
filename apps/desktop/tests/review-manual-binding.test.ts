import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "manual comment authoritative draft binding")) {
	const { _setDbForTesting } = await import("../src/main/db");
	const schema = await import("../src/main/db/schema");
	const { ReviewPathStorage } = await import("../src/main/review-path/storage");
	const { aiReviewRouter } = await import("../src/main/trpc/routers/ai-review");
	const { makeTestDb } = await import("./test-db");
	const head = "a".repeat(40);
	const time = new Date("2026-11-21T12:00:00Z");
	const identity = {
		workspaceId: "w",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: head,
	};
	const input = {
		workspaceId: "w",
		prProvider: "github" as const,
		prIdentifier: "o/r#1",
		prTitle: "PR",
		commitSha: head,
		filePath: "a.ts",
		lineNumber: 12,
		side: "LEFT" as const,
		body: "Current manual comment",
	};
	const agent = { id: "codex", label: "Codex" };
	function fixture() {
		const db = makeTestDb();
		_setDbForTesting(db);
		db.insert(schema.projects)
			.values({ id: "p", name: "P", repoPath: "/disposable", createdAt: time, updatedAt: time })
			.run();
		for (const id of ["w", "other"])
			db.insert(schema.workspaces)
				.values({
					id,
					projectId: "p",
					name: id,
					type: "review",
					prProvider: "github",
					prIdentifier: id === "w" ? "o/r#1" : "o/r#2",
					createdAt: time,
					updatedAt: time,
				})
				.run();
		const storage = new ReviewPathStorage(db);
		const draft = (id: string, status = "ready") => {
			db.insert(schema.reviewDrafts)
				.values({
					id,
					prProvider: "github",
					prIdentifier: "o/r#1",
					prTitle: "PR",
					prAuthor: "",
					sourceBranch: "source",
					targetBranch: "target",
					status,
					commitSha: head,
					createdAt: time,
					updatedAt: time,
				})
				.run();
		};
		const bind = (id: string) => {
			const run = storage.begin(identity, agent, ["a.ts"]);
			storage.attachReviewDraft(run, id);
			return run;
		};
		return { db, storage, draft, bind, caller: aiReviewRouter.createCaller({}) };
	}

	test("equal timestamps cannot redirect a scoped manual comment to the previous ready draft", async () => {
		const f = fixture();
		try {
			f.draft("previous");
			f.draft("current", "in_progress");
			f.bind("current");
			const result = await f.caller.addUserComment({ ...input, reviewDraftId: "current" });
			expect(result.reviewDraftId).toBe("current");
			expect(f.db.select().from(schema.draftComments).all()).toMatchObject([
				{ reviewDraftId: "current", side: "LEFT", lineNumber: 12 },
			]);
		} finally {
			_setDbForTesting(null);
		}
	});

	test("a stale explicit draft after remapping rejects without inserting any comment", async () => {
		const f = fixture();
		try {
			f.draft("previous", "in_progress");
			f.bind("previous");
			f.draft("current", "in_progress");
			f.bind("current");
			await expect(
				f.caller.addUserComment({ ...input, reviewDraftId: "previous" })
			).rejects.toThrow();
			expect(f.db.select().from(schema.draftComments).all()).toEqual([]);
		} finally {
			_setDbForTesting(null);
		}
	});

	test("workspace binding remains authoritative when the optional draft ID is omitted", async () => {
		const f = fixture();
		try {
			f.draft("previous");
			f.draft("current", "in_progress");
			f.bind("current");
			expect((await f.caller.addUserComment(input)).reviewDraftId).toBe("current");
		} finally {
			_setDbForTesting(null);
		}
	});

	test("manual comment after submission creates and persists a fresh binding instead of reviving old ready findings", async () => {
		const f = fixture();
		try {
			f.draft("previous");
			f.draft("submitted", "in_progress");
			f.bind("submitted");
			f.db
				.update(schema.reviewDrafts)
				.set({ status: "submitted" })
				.where(eq(schema.reviewDrafts.id, "submitted"))
				.run();
			const result = await f.caller.addUserComment({ ...input, reviewDraftId: "submitted" });
			expect(["previous", "submitted"]).not.toContain(result.reviewDraftId);
			expect(result.commitSha).toBe(head);
			expect(
				f.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, "w")).get()
					?.reviewDraftId
			).toBe(result.reviewDraftId);
			const second = await f.caller.addUserComment({
				...input,
				reviewDraftId: result.reviewDraftId,
			});
			expect(second.reviewDraftId).toBe(result.reviewDraftId);
		} finally {
			_setDbForTesting(null);
		}
	});

	for (const invalid of [
		{ workspaceId: "missing" },
		{ workspaceId: "other" },
		{ prProvider: "bitbucket" as const },
		{ prIdentifier: "o/r#2" },
		{ commitSha: "b".repeat(40) },
	]) {
		test(`scoped comment rejects mismatched identity ${JSON.stringify(invalid)}`, async () => {
			const f = fixture();
			try {
				f.draft("current", "in_progress");
				f.bind("current");
				await expect(
					f.caller.addUserComment({ ...input, reviewDraftId: "current", ...invalid })
				).rejects.toThrow();
				expect(f.db.select().from(schema.draftComments).all()).toEqual([]);
			} finally {
				_setDbForTesting(null);
			}
		});
	}

	for (const alsoReview of [false, true]) {
		test(`mapping initialization with alsoReview=${alsoReview} preserves draft authority`, async () => {
			const f = fixture();
			try {
				const options = { auto: false, alsoReview };
				f.storage.begin(identity, agent, ["a.ts"], options);
				if (alsoReview) {
					await expect(f.caller.addUserComment(input)).rejects.toThrow();
					expect(f.db.select().from(schema.draftComments).all()).toEqual([]);
				} else {
					const result = await f.caller.addUserComment(input);
					expect(result.commitSha).toBe(head);
					expect(f.db.select().from(schema.draftComments).all()).toHaveLength(1);
				}
			} finally {
				_setDbForTesting(null);
			}
		});
	}

	test("legacy unscoped requests reuse one exact-revision draft but reject ambiguous candidates", async () => {
		const f = fixture();
		try {
			const { workspaceId: _workspaceId, ...legacy } = input;
			f.draft("unique");
			expect((await f.caller.addUserComment(legacy)).reviewDraftId).toBe("unique");
			f.draft("ambiguous");
			await expect(f.caller.addUserComment(legacy)).rejects.toThrow();
			expect(f.db.select().from(schema.draftComments).all()).toHaveLength(1);
		} finally {
			_setDbForTesting(null);
		}
	});
}
