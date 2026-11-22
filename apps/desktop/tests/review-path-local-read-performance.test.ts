import { expect, test } from "bun:test";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "reading path unchanged local reads")) {
	const { makeTestDb } = await import("./test-db");
	const schema = await import("../src/main/db/schema");
	const { ReviewPathStorage } = await import("../src/main/review-path/storage");
	const { ReviewPathApplication } = await import("../src/main/review-path/application");
	const identity = {
		workspaceId: "w",
		provider: "github" as const,
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	};
	for (const persisted of [false, true]) {
		test(`same-head polling performs zero durable writes with persisted=${persisted}`, async () => {
			const db = makeTestDb();
			const now = new Date();
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
					prIdentifier: "o/r#1",
					createdAt: now,
					updatedAt: now,
				})
				.run();
			const storage = new ReviewPathStorage(db);
			if (persisted) storage.get(identity);
			const app = new ReviewPathApplication({
				storage,
				validateWorkspace: () => {},
				runtime: () => {
					throw Error("Unexpected runtime initialization");
				},
				resolve: async () => {
					throw Error("Unchanged polling must stay local");
				},
			});
			const before = db.select().from(schema.reviewPathDocuments).all();
			const writesBefore = db.$client.prepare("SELECT total_changes() AS count").get();
			const initial = await app.get(identity);
			for (let index = 0; index < 20; index++) {
				const result = await app.get(identity);
				expect(result.identity).toEqual(identity);
				expect(result.runs).toEqual([]);
				expect(result).toEqual(initial);
			}
			const writesAfter = db.$client.prepare("SELECT total_changes() AS count").get();
			console.log("local polling write counts", { persisted, writesBefore, writesAfter });
			expect(writesAfter).toEqual(writesBefore);
			expect(db.select().from(schema.reviewPathDocuments).all()).toEqual(before);
			if (!persisted) {
				const { run } = storage.enqueueQuestion(identity, { id: "q", text: "Why?" });
				expect(run.conversationId).toMatch(/^[0-9a-f-]{36}$/);
				expect(run.conversationId).not.toBe(initial.conversationId);
				const mapping = storage.begin(identity, { id: "codex", label: "Codex" }, []);
				expect(mapping.conversationId).toMatch(/^[0-9a-f-]{36}$/);
				expect(mapping.conversationId).not.toBe(run.conversationId);
			}
			db.$client.close();
		});
	}
}
