import "./preload-electron-mock";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { registerReviewPathTools } from "../mcp-standalone/review-path.mjs";
import { startControlPlane } from "../src/main/control-plane";
import { _setDbForTesting, type getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathApplication } from "../src/main/review-path/application";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import { createReviewPathRouter } from "../src/main/trpc/routers/review-path";
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
	sql.exec("PRAGMA foreign_keys = ON");
	const db = drizzle(sql, { schema });
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	const now = new Date();
	db.insert(schema.projects)
		.values({ id: "p", repoPath: "/isolated", name: "p", createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.workspaces)
		.values({
			id: "w",
			projectId: "p",
			type: "review",
			name: "review",
			prProvider: "github",
			prIdentifier: "o/r#1",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const typed = db as unknown as ReturnType<typeof getDb>;
	return { db: typed, storage: new ReviewPathStorage(typed) };
}
test("isolated migration startup, authenticated task bootstrap and actual MCP tool transport", async () => {
	const { db, storage } = setup();
	_setDbForTesting(db);
	const run = storage.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
	const server = await startControlPlane({
		confirm: async () => {
			throw Error("No approval expected");
		},
		spawnFn: async () => {
			throw Error("No launch expected");
		},
	});
	try {
		server.taskRegistry.register("task-secret", {
			mode: "review-path",
			projectId: "p",
			workspaceId: "w",
			modeContext: { reviewPathRunId: run.id, reviewPathRunVersion: String(run.version) },
		});
		const auth = { Authorization: `Bearer ${server.token}` };
		const base = `http://127.0.0.1:${server.port}`;
		expect((await fetch(`${base}/review-path.tool`, { method: "POST", body: "{}" })).status).toBe(
			401
		);
		expect(
			(await fetch(`${base}/review-path.tool`, { method: "POST", headers: auth, body: "{}" }))
				.status
		).toBe(403);
		const context = await (
			await fetch(`${base}/context.resolve?taskToken=task-secret`, { headers: auth })
		).json();
		expect(context.mode).toBe("review-path");
		const handlers = new Map<
			string,
			(args: Record<string, unknown>) => Promise<{ isError?: boolean }>
		>();
		const fakeServer = {
			tool: (
				name: string,
				_description: string,
				_schema: unknown,
				handler: (args: Record<string, unknown>) => Promise<{ isError?: boolean }>
			) => {
				handlers.set(name, handler);
			},
		};
		registerReviewPathTools(
			fakeServer as unknown as Parameters<typeof registerReviewPathTools>[0],
			{ context, discovery: { port: server.port, token: server.token } }
		);
		const set = handlers.get("set_review_path");
		if (!set) throw Error("Missing registered tool");
		const args = { run_id: run.id, run_version: run.version, entries: [], otherFiles: ["a.ts"] };
		expect((await set(args)).isError).not.toBe(true);
		expect((await set({ ...args, workspaceId: "other" })).isError).toBe(true);
		await handlers.get("finish_review_path")?.({ run_id: run.id, run_version: run.version });
		expect(storage.peek(identity).path?.status).toBe("ready");
		expect((await set(args)).isError).toBe(true);
	} finally {
		await server.stop();
		_setDbForTesting(null);
	}
});
test("real tRPC boundary validates inputs and delegates launches and cancellation to injected port", async () => {
	const { storage } = setup();
	const calls: string[] = [];
	const app = new ReviewPathApplication({
		storage,
		validateWorkspace: (i) => {
			if (i.workspaceId !== "w") throw Error("wrong workspace");
		},
		resolve: async (identity) => ({ identity, changedFiles: ["a.ts"] }),
		runtime: () => ({
			startMapping: async () => {
				calls.push("start");
				return { terminalId: "owned" };
			},
			stopMapping: async () => {
				calls.push("stop");
			},
			ask: async () => {
				calls.push("ask");
				return {};
			},
			cancelQuestion: async () => {
				calls.push("cancel-question");
			},
		}),
	});
	const caller = createReviewPathRouter(() => app).createCaller({});
	await expect(
		caller.start({
			identity: { ...identity, workspaceId: "other" },
			agent: { id: "codex", label: "Codex" },
			alsoReview: false,
		})
	).rejects.toThrow("wrong workspace");
	const started = await caller.start({
		identity,
		agent: { id: "codex", label: "Codex" },
		alsoReview: false,
	});
	expect(started.launch?.terminalId).toBe("owned");
	await caller.cancel({ identity, id: started.run.id, version: started.run.version });
	expect(calls).toEqual(["start", "stop"]);
	expect((await caller.get({ identity })).path?.status).toBe("failed");
});

test("local findings are owned by the exact run/draft and never accept delayed writes", () => {
	const { db, storage } = setup();
	const now = new Date();
	db.insert(schema.reviewDrafts)
		.values({
			id: "draft",
			prProvider: "github",
			prIdentifier: "o/r#1",
			prTitle: "Test",
			prAuthor: "author",
			sourceBranch: "branch",
			targetBranch: "main",
			commitSha: identity.headSha,
			status: "in_progress",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const run = storage.begin(identity, { id: "codex", label: "Codex" }, ["a.ts"]);
	expect(() =>
		storage.addFinding(run, {
			file_path: "a.ts",
			line_number: 1,
			side: "RIGHT",
			body: "Check this",
		})
	).toThrow();
	storage.attachReviewDraft(run, "draft");
	storage.addFinding(run, { file_path: "a.ts", line_number: 1, side: "RIGHT", body: "Check this" });
	storage.addFinding(run, { file_path: "a.ts", line_number: 1, side: "RIGHT", body: "Check this" });
	expect(db.select().from(schema.draftComments).all()).toHaveLength(1);
	expect(() => storage.addFinding(run, { file_path: "unrelated.ts", body: "Wrong" })).toThrow();
	storage.finish(run);
	expect(db.select().from(schema.reviewDrafts).get()?.status).toBe("ready");
	expect(() => storage.addFinding(run, { file_path: "a.ts", body: "Late" })).toThrow();
});
