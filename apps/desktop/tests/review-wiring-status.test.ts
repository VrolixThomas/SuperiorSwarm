import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { _setDbForTesting, type getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import { createReviewPathRouter } from "../src/main/trpc/routers/review-path";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "readonly review wiring router")) {
	test("queue discovery reads never-opened maps, scopes providers/projects/head, and never writes", async () => {
		const sqlite = new Database(":memory:");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
		_setDbForTesting(db as unknown as ReturnType<typeof getDb>);
		const now = new Date();
		const store = new ReviewPathStorage(db as unknown as ReturnType<typeof getDb>);
		const identity = {
			workspaceId: "w",
			provider: "github" as const,
			owner: "org",
			repo: "repo",
			prNumber: 1,
			headSha: "a".repeat(40),
		};
		const caller = createReviewPathRouter(() => {
			throw Error("Status must not resolve/mutate application");
		}).createCaller({});
		try {
			db.insert(schema.projects)
				.values({ id: "p", name: "P", repoPath: "/disposable", createdAt: now, updatedAt: now })
				.run();
			db.insert(schema.workspaces)
				.values({
					id: "w",
					projectId: "p",
					name: "W",
					type: "review",
					prProvider: "github",
					prIdentifier: "org/repo#1",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			const run = store.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
			const terminalId = `review-path:${run.id}:${run.version}`;
			store.attachTerminal(run, terminalId);
			db.insert(schema.terminalSessions)
				.values({
					id: terminalId,
					workspaceId: "w",
					cwd: "/disposable/review",
					title: "Review",
					sortOrder: 0,
					updatedAt: now,
				})
				.run();
			const { workspaceId: _workspace, ...scope } = identity;
			const before = sqlite.query("SELECT total_changes() AS n").get();
			const result = await caller.status(scope);
			expect(result?.identity.workspaceId).toBe("w");
			expect(result?.status).toBe("mapping");
			expect(result?.terminal).toEqual({
				terminalId,
				reviewWorkspaceId: "w",
				worktreePath: "/disposable/review",
			});
			expect(await caller.status({ ...scope, provider: "bitbucket" })).toBeNull();
			expect(await caller.status({ ...scope, projectId: "other" })).toBeNull();
			expect(await caller.status({ ...scope, workspaceId: "other" })).toBeNull();
			expect(
				(await caller.status({ ...scope, headSha: "b".repeat(40) }))?.terminal
			).toBeUndefined();
			expect((await caller.status({ ...scope, headSha: "b".repeat(40) }))?.status).toBe("stale");
			expect(sqlite.query("SELECT total_changes() AS n").get()).toEqual(before);
			expect(store.peek(identity).identity.headSha).toBe(identity.headSha);
			db.insert(schema.projects)
				.values({ id: "p2", name: "P2", repoPath: "/disposable2", createdAt: now, updatedAt: now })
				.run();
			db.insert(schema.workspaces)
				.values({
					id: "second",
					projectId: "p2",
					name: "Second",
					type: "review",
					prProvider: "github",
					prIdentifier: "org/repo#1",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			expect(await caller.status(scope)).toBeNull();
			expect((await caller.status(identity))?.identity.workspaceId).toBe("w");
			db.update(schema.terminalSessions)
				.set({ workspaceId: "second" })
				.where(eq(schema.terminalSessions.id, terminalId))
				.run();
			expect((await caller.status(identity))?.terminal).toBeUndefined();
		} finally {
			_setDbForTesting(null);
			sqlite.close();
		}
	});
}
