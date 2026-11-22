import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { getReviewDrafts } from "../src/main/ai-review/orchestrator";
import { publishReview } from "../src/main/ai-review/review-publisher";
import { _setDbForTesting, type getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { registerGitProvider } from "../src/main/providers/git-provider";
import type { CreateCommentParams, GitProvider } from "../src/main/providers/types";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import { pickLatestDraft } from "../src/renderer/lib/pr-review-threads";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

function fixture() {
	const sql = new Database(":memory:");
	const db = drizzle(sql, { schema });
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	const now = new Date();
	db.insert(schema.projects)
		.values({ id: "v4-p", name: "V4", repoPath: "/disposable", createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.workspaces)
		.values({
			id: "v4-w",
			projectId: "v4-p",
			name: "V4",
			type: "review",
			prProvider: "github",
			prIdentifier: "v4/repo#1",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	return { sql, db, store: new ReviewPathStorage(db as unknown as ReturnType<typeof getDb>) };
}
const identity = {
	workspaceId: "v4-w",
	provider: "github" as const,
	owner: "v4",
	repo: "repo",
	prNumber: 1,
	headSha: "a".repeat(40),
};
const changed = {
	id: "entry-file",
	kind: "changed" as const,
	path: "a.ts",
	note: "entry",
	focus: [],
	tests: [],
};

if (inIsolatedFileBrowserTest(import.meta.path, "V4 independent persisted review probes")) {
	test("V4: streamed replacement must retain user context when agent reuses its path with a fresh ID", () => {
		const { sql, store } = fixture();
		try {
			const run = store.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
			store.setPath(run, {
				entries: [{ id: "entry", title: "Entry", steps: [changed] }],
				otherFiles: [],
			});
			const user = {
				id: "user-context",
				kind: "context" as const,
				addedBy: "user" as const,
				path: "context.ts",
				note: "Keep my reasoning",
				focus: [],
			};
			store.addUserContext(identity, "entry", user);
			try {
				store.setPath(run, {
					entries: [
						{
							id: "entry",
							title: "Entry",
							steps: [
								changed,
								{ ...user, id: "agent-context", addedBy: "agent", note: "Replacement" },
							],
						},
					],
					otherFiles: [],
				});
			} catch {
				/* Rejecting a conflicting replacement is also correct. */
			}
			expect(store.peek(identity).path?.entries.flatMap((entry) => entry.steps)).toContainEqual(
				user
			);
		} finally {
			sql.close();
		}
	});

	test("V4: publishing a pinned reading-path finding must not transplant its line onto a newer head", async () => {
		const { sql, db, store } = fixture();
		_setDbForTesting(db as unknown as ReturnType<typeof getDb>);
		const writes: CreateCommentParams[] = [];
		registerGitProvider({
			name: "github",
			getPRState: async () => ({ headSha: "b".repeat(40), state: "open" }),
			getPRFiles: async () => [{ path: "a.ts", status: "modified" }],
			createInlineComment: async (input: CreateCommentParams) => {
				writes.push(input);
				return { id: "test-only", nodeId: "test-thread" };
			},
			submitReview: async () => {},
		} as unknown as GitProvider);
		try {
			const run = store.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
			const now = new Date();
			db.insert(schema.reviewDrafts)
				.values({
					id: "v4-draft",
					prProvider: "github",
					prIdentifier: "v4/repo#1",
					prTitle: "Fixture",
					prAuthor: "author",
					sourceBranch: "feature",
					targetBranch: "main",
					status: "in_progress",
					commitSha: identity.headSha,
					createdAt: now,
					updatedAt: now,
				})
				.run();
			store.attachReviewDraft(run, "v4-draft");
			store.addFinding(run, {
				file_path: "a.ts",
				line_number: 12,
				side: "RIGHT",
				body: "Bug at original head line 12",
			});
			store.finish(run);
			db.update(schema.draftComments)
				.set({ status: "user-pending" })
				.where(eq(schema.draftComments.reviewDraftId, "v4-draft"))
				.run();
			await publishReview("v4-draft", "COMMENT");
			// Blocking stale publication or explicitly retaining the original commit is safe.
			expect(writes.filter((write) => write.commitId !== identity.headSha)).toEqual([]);
		} finally {
			_setDbForTesting(null);
			sql.close();
		}
	});

	test("V4: a second completed reading-path review must be selected over its first round-one draft", () => {
		const { sql, db, store } = fixture();
		_setDbForTesting(db as unknown as ReturnType<typeof getDb>);
		try {
			for (const id of ["old-reading-path", "new-reading-path"]) {
				const run = store.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
				const now = new Date();
				// Production runtime creates a fresh chain with roundNumber:1 for each Map + Also review.
				db.insert(schema.reviewDrafts)
					.values({
						id,
						prProvider: "github",
						prIdentifier: "v4/repo#1",
						prTitle: "Fixture",
						prAuthor: "author",
						sourceBranch: "feature",
						targetBranch: "main",
						status: "in_progress",
						commitSha: identity.headSha,
						roundNumber: 1,
						reviewChainId: id,
						createdAt: now,
						updatedAt: now,
					})
					.run();
				store.attachReviewDraft(run, id);
				store.addFinding(run, { file_path: "a.ts", body: id });
				store.finish(run);
			}
			expect(db.select().from(schema.workspaces).get()?.reviewDraftId).toBe("new-reading-path");
			// These are exactly the production list and renderer selection helper, not fixture sorting.
			const selected = pickLatestDraft(
				getReviewDrafts().filter((draft) => draft.prProvider === "github"),
				"v4/repo#1"
			);
			expect(selected?.id).toBe("new-reading-path");
		} finally {
			_setDbForTesting(null);
			sql.close();
		}
	});
}
