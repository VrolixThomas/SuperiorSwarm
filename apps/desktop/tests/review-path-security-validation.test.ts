import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { startControlPlane } from "../src/main/control-plane";
import { _setDbForTesting, type getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathApplication } from "../src/main/review-path/application";
import { executeReviewPathTool } from "../src/main/review-path/control";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import type { ReviewPathIdentity } from "../src/shared/review-path-runtime";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
const agent = { id: "codex", label: "Codex" };
function setup() {
	const root = mkdtempSync(join(tmpdir(), "reading-security-"));
	const sql = new Database(":memory:");
	const db = drizzle(sql, { schema });
	migrate(db, { migrationsFolder: join(import.meta.dir, "../src/main/db/migrations") });
	const now = new Date();
	db.insert(schema.projects)
		.values({ id: "p", repoPath: root, name: "p", createdAt: now, updatedAt: now })
		.run();
	db.insert(schema.worktrees)
		.values({
			id: "wt",
			projectId: "p",
			path: root,
			branch: "synthetic",
			baseBranch: "main",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	db.insert(schema.workspaces)
		.values({
			id: "w",
			projectId: "p",
			worktreeId: "wt",
			type: "review",
			name: "review",
			prProvider: "github",
			prIdentifier: "o/r#1",
			createdAt: now,
			updatedAt: now,
		})
		.run();
	const typed = db as unknown as ReturnType<typeof getDb>;
	return {
		root,
		db: typed,
		storage: new ReviewPathStorage(typed),
		close() {
			sql.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

if (
	inIsolatedFileBrowserTest(
		import.meta.path,
		"V3 adversarial backend security regressions in isolation"
	)
) {
	// Intentionally RED: assertions describe the required security/correctness invariant.
	test("V3: delayed provider read cannot roll back a newer head and revoke its capability", async () => {
		const fixture = setup();
		try {
			const { storage } = fixture;
			const old = { ...identity, headSha: "b".repeat(40) };
			const newest = { ...identity, headSha: "c".repeat(40) };
			storage.begin(identity, agent, ["a.ts"]);
			let release!: () => void;
			let entered!: () => void;
			const started = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const app = new ReviewPathApplication({
				storage,
				validateWorkspace: () => {},
				runtime: () => {
					throw Error("no runtime expected");
				},
				resolve: async () => {
					entered();
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					return { identity: old, changedFiles: ["a.ts"] };
				},
			});
			const lateRead = app.get(old);
			await started;
			const current = storage.begin(newest, agent, ["a.ts"]);
			const capability = storage.grantCapability(current);
			release();
			await lateRead;
			let authenticated = false;
			try {
				authenticated = storage.authenticateCapability(capability).id === current.id;
			} catch {
				/* Record rejection without exposing the capability. */
			}
			expect({
				head: storage.peek(newest).identity.headSha,
				state: storage.getRun(current.id)?.state,
				authenticated,
			}).toEqual({ head: newest.headSha, state: "running", authenticated: true });
		} finally {
			fixture.close();
		}
	});

	test("V3: streamed replacement cannot overwrite user context by changing only its step ID", () => {
		const fixture = setup();
		try {
			const { storage } = fixture;
			const run = storage.begin(identity, agent, ["a.ts"]);
			storage.setPath(run, {
				entries: [{ id: "entry", title: "Entry", steps: [] }],
				otherFiles: ["a.ts"],
			});
			const user = {
				id: "user-context",
				kind: "context" as const,
				addedBy: "user" as const,
				path: "context.ts",
				note: "User explanation",
				focus: [],
			};
			storage.addUserContext(identity, "entry", user);
			const capability = storage.grantCapability(run);
			try {
				executeReviewPathTool(storage, capability, {
					tool: "set_review_path",
					run_id: run.id,
					run_version: run.version,
					entries: [
						{
							id: "entry",
							title: "Entry",
							steps: [{ ...user, id: "agent-context", addedBy: "agent", note: "Replaced" }],
						},
					],
					otherFiles: ["a.ts"],
				});
			} catch {
				/* Rejecting the overwrite is also valid. */
			}
			expect(storage.peek(identity).path?.entries.flatMap((entry) => entry.steps)).toContainEqual(
				user
			);
		} finally {
			fixture.close();
		}
	});

	test("V3: replayed reading task token fails closed instead of acquiring workspace-agent authority", async () => {
		const fixture = setup();
		_setDbForTesting(fixture.db);
		const server = await startControlPlane({
			confirm: async () => {
				throw Error("No approval expected");
			},
			spawnFn: async () => {
				throw Error("No spawn expected");
			},
		});
		const originalLog = console.log;
		const logs: string[] = [];
		console.log = (...args) => {
			logs.push(args.join(" "));
		};
		try {
			const run = fixture.storage.begin(identity, agent, ["a.ts"]);
			server.taskRegistry.register("synthetic-task", {
				mode: "review-path",
				projectId: "p",
				workspaceId: "w",
				modeContext: { reviewPathRunId: run.id, reviewPathRunVersion: String(run.version) },
			});
			const url = `http://127.0.0.1:${server.port}/context.resolve?${new URLSearchParams({ taskToken: "synthetic-task", cwd: fixture.root })}`;
			const headers = { Authorization: `Bearer ${server.token}` };
			const first = await fetch(url, { headers });
			expect((await first.json()).mode).toBe("review-path");
			const replay = await fetch(url, { headers });
			const body = await replay.json();
			expect({ status: replay.status, mode: body.mode }).toEqual({ status: 403, mode: undefined });
		} finally {
			console.log = originalLog;
			await server.stop();
			_setDbForTesting(null);
			fixture.close();
		}
	});

	test("V3: runtime local-object check cannot execute a promisor remote helper", async () => {
		const fixture = setup();
		_setDbForTesting(fixture.db);
		const { setDaemonClient } = await import("../src/main/terminal/daemon-instance");
		const { getReviewPathRuntime } = await import("../src/main/review-path/runtime");
		// No real terminal or provider is contacted: the object check happens before both.
		setDaemonClient({ isConnected: true } as unknown as import(
			"../src/main/terminal/daemon-client"
		).DaemonClient);
		try {
			const git = (...args: string[]) =>
				execFileSync("git", args, { cwd: fixture.root, stdio: "pipe" });
			git("init");
			const marker = join(fixture.root, "helper-executed");
			const helper = join(fixture.root, "helper.sh");
			writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`, { mode: 0o700 });
			git("config", "remote.origin.url", `ext::${helper}`);
			git("config", "remote.origin.promisor", "true");
			git("config", "remote.origin.partialclonefilter", "blob:none");
			git("config", "protocol.ext.allow", "always");
			const run = fixture.storage.begin(identity, agent, ["a.ts"]);
			const runtime = getReviewPathRuntime(fixture.storage);
			await expect(runtime.startMapping({ run, agent, alsoReview: false })).rejects.toThrow();
			expect(existsSync(marker)).toBe(false);
		} finally {
			setDaemonClient({ isConnected: false } as unknown as import(
				"../src/main/terminal/daemon-client"
			).DaemonClient);
			_setDbForTesting(null);
			fixture.close();
		}
	});
}
