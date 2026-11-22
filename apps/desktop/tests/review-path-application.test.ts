import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathApplication } from "../src/main/review-path/application";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import type { ReviewPathIdentity, ReviewPathRuntimePort } from "../src/shared/review-path-runtime";
const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
const input = { identity, agent: { id: "codex", label: "Codex" }, alsoReview: true };
function setup() {
	const sql = new Database(":memory:");
	sql.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY);INSERT INTO workspaces VALUES ('w');");
	sql.exec(
		readFileSync(
			new URL("../src/main/db/migrations/0065_add_review_path_persistence.sql", import.meta.url),
			"utf8"
		)
	);
	const storage = new ReviewPathStorage(
		drizzle(sql, { schema }) as unknown as ReturnType<typeof getDb>
	);
	const calls: string[] = [];
	const runtime: ReviewPathRuntimePort = {
		startMapping: async () => {
			calls.push("start");
			return { terminalId: "owned" };
		},
		stopMapping: async () => {
			calls.push("stop");
		},
		ask: async () => {
			calls.push("ask");
			return { terminalId: "question" };
		},
		cancelQuestion: async () => {
			calls.push("cancelQuestion");
		},
	};
	const app = new ReviewPathApplication({
		storage,
		runtime: () => runtime,
		validateWorkspace: (i) => {
			if (i.workspaceId !== "w") throw Error("wrong workspace");
		},
		resolve: async (i) => ({ identity: i, changedFiles: ["a.ts"] }),
	});
	return { app, storage, runtime, calls };
}
test("automatic start and duplicate questions launch only once, cancel fences before runtime stop", async () => {
	const { app, storage, calls, runtime } = setup();
	const first = await app.start({ ...input, auto: true });
	await app.start({ ...input, auto: true });
	expect(calls).toEqual(["start"]);
	await app.ask(identity, { id: "q", text: "question" });
	await app.ask(identity, { id: "q", text: "question" });
	expect(calls).toEqual(["start", "ask"]);
	runtime.stopMapping = async ({ run }) => {
		expect(storage.getRun(run.id)?.state).toBe("cancelled");
	};
	await app.cancel(first.run);
	expect(() => storage.setPath(first.run, { entries: [], otherFiles: ["a.ts"] })).toThrow();
});
test("provider head change refuses stale launch and authoritative read retains stale path", async () => {
	const { app, storage, calls } = setup();
	const first = await app.start(input);
	app.deps.resolve = async () => ({
		identity: { ...identity, headSha: "b".repeat(40) },
		changedFiles: ["b.ts"],
	});
	await expect(app.start(input)).rejects.toThrow("head changed");
	expect(calls).toEqual(["start"]);
	expect(storage.getRun(first.run.id)?.state).toBe("superseded");
	expect((await app.get(identity)).path?.status).toBe("stale");
});
test("launch failure is durable; late launch completion cannot restore a superseded head", async () => {
	const { app, storage, runtime } = setup();
	runtime.startMapping = async () => {
		throw Error("launch broke");
	};
	await expect(app.start(input)).rejects.toThrow("launch broke");
	expect(storage.peek(identity).path?.error).toBe("launch broke");
	let release: () => void = () => {};
	runtime.startMapping = () =>
		new Promise((resolve) => {
			release = () => resolve({ terminalId: "late" });
		});
	const pending = app.start(input);
	await new Promise((resolve) => setTimeout(resolve, 0));
	storage.get({ ...identity, headSha: "b".repeat(40) });
	release();
	await pending;
	expect(storage.peek(identity).identity.headSha).toBe("b".repeat(40));
	expect(storage.getActiveRuns()).toEqual([]);
});
