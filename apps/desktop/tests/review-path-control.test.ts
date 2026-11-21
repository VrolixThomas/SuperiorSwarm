import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { authorizeReviewPathTask, executeReviewPathTool } from "../src/main/review-path/control";
import { ReviewPathStorage } from "../src/main/review-path/storage";
const identity = {
	workspaceId: "w",
	provider: "github" as const,
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
function setup() {
	const sql = new Database(":memory:");
	sql.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY);INSERT INTO workspaces VALUES ('w');");
	sql.exec(
		readFileSync(
			new URL("../src/main/db/migrations/0065_add_review_path_persistence.sql", import.meta.url),
			"utf8"
		)
	);
	const store = new ReviewPathStorage(
		drizzle(sql, { schema }) as unknown as ReturnType<typeof getDb>
	);
	const run = store.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
	return { store, run };
}
test("task capability rejects arbitrary workspace, provider, PR, run and payload selectors", () => {
	const { store, run } = setup();
	const reg = {
		mode: "review-path" as const,
		projectId: "p",
		workspaceId: "w",
		modeContext: { reviewPathRunId: run.id, reviewPathRunVersion: String(run.version) },
	};
	expect(() => authorizeReviewPathTask(store, { ...reg, workspaceId: "other" })).toThrow();
	const token = authorizeReviewPathTask(store, reg);
	expect(() =>
		executeReviewPathTool(store, "wrong", {
			tool: "get_review_path",
			run_id: run.id,
			run_version: run.version,
		})
	).toThrow();
	expect(() =>
		executeReviewPathTool(store, token, {
			tool: "get_review_path",
			run_id: "other",
			run_version: run.version,
		})
	).toThrow();
	expect(() =>
		executeReviewPathTool(store, token, {
			tool: "get_review_path",
			run_id: run.id,
			run_version: run.version,
			workspaceId: "other",
		})
	).toThrow();
	const args = { run_id: run.id, run_version: run.version };
	executeReviewPathTool(store, token, {
		...args,
		tool: "set_review_path",
		entries: [],
		otherFiles: ["a.ts"],
	});
	executeReviewPathTool(store, token, { ...args, tool: "finish_review_path" });
	expect(() =>
		executeReviewPathTool(store, token, {
			...args,
			tool: "set_review_path",
			entries: [],
			otherFiles: ["a.ts"],
		})
	).toThrow();
});
