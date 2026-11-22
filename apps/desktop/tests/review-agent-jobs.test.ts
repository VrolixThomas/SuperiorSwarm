import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathApplication } from "../src/main/review-path/application";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import type { ReviewPathIdentity, ReviewPathRuntimePort } from "../src/shared/review-path-runtime";
function required<T>(value: T | undefined | null): T {
	if (value === undefined || value === null) throw new Error("Missing test fixture value");
	return value;
}
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
	return { app, storage, runtime, calls, sql };
}
test("accepts durably before stalled metadata, deduplicates request and cancels without late launch", async () => {
	const { app, storage, calls } = setup();
	let release!: (value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void;
	app.deps.resolve = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const job = app.startJob({ ...input, requestId: "click-1" });
	expect(job.state).toBe("queued");
	expect(app.jobs("w")[0]?.id).toBe(job.id);
	expect(app.startJob({ ...input, requestId: "click-1" }).id).toBe(job.id);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await app.cancelJob("w", job.id);
	release({ identity, changedFiles: ["a.ts"] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(app.jobs("w")[0]?.state).toBe("cancelled");
	expect(storage.getActiveRuns()).toEqual([]);
	expect(calls).toEqual([]);
});
test("retry keeps job identity and rotates attempt/run; restoring reads never launch", async () => {
	const { app, storage, calls, runtime } = setup();
	runtime.startMapping = async () => {
		throw Error("offline");
	};
	const first = app.startJob({ ...input, requestId: "first" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	const failed = required(app.jobs("w")[0]);
	expect(failed.state).toBe("failed");
	runtime.startMapping = async () => ({ terminalId: "new-terminal", worktreePath: "/isolated" });
	const retry = app.startJob({ ...input, requestId: "retry", retryJobId: first.id });
	expect(retry.id).toBe(first.id);
	expect(retry.attempt).toBe(2);
	await new Promise((resolve) => setTimeout(resolve, 10));
	const running = required(app.jobs("w")[0]);
	expect(running.runId).not.toBe(failed.runId);
	expect(running.runVersion).toBeGreaterThan(required(failed.runVersion));
	expect(running.cwd).toBe("/isolated");
	expect(storage.jobs("w")[0]?.id).toBe(first.id);
	expect(calls).toEqual([]);
});
test("request IDs cannot be reused with different scoped intent", () => {
	const { app } = setup();
	app.startJob({ ...input, requestId: "same" });
	expect(() => app.startJob({ ...input, alsoReview: false, requestId: "same" })).toThrow("reused");
});
test("completed mapping followed by Ask gets a fresh scoped question run and keeps anchor", async () => {
	const { app, storage, runtime } = setup();
	const mapping = app.startJob({ ...input, alsoReview: false, requestId: "mapping" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	const mapped = required(app.jobs("w").find((j) => j.id === mapping.id));
	const run = required(storage.getRun(required(mapped.runId)));
	storage.finish(run);
	expect(app.jobs("w").find((j) => j.id === mapping.id)?.state).toBe("completed");
	const anchor = { path: "a.ts", side: "RIGHT" as const, startLine: 1, endLine: 2 };
	runtime.ask = async ({ run: questionRun, question, agent }) => {
		expect(questionRun.id).not.toBe(run.id);
		expect(question.message.anchor).toEqual(anchor);
		expect(agent?.id).toBe("codex");
		storage.answerQuestion(questionRun, question.id, { text: "Answer" });
		return { terminalId: "answer-terminal" };
	};
	const questionJob = app.askJob({
		identity,
		agent: input.agent,
		requestId: "question",
		question: { id: "question", text: "Why?", anchor },
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(app.jobs("w").find((j) => j.id === questionJob.id)?.state).toBe("completed");
	expect(storage.peek(identity).messages.at(-1)?.text).toBe("Answer");
	expect(() => storage.setPath(run, { entries: [], otherFiles: ["a.ts"] })).toThrow();
});
test("restart fences queued jobs without launching and legacy timing stays unknown", async () => {
	const { app, storage, calls } = setup();
	const accepted = app.startJob({ ...input, requestId: "restart" });
	storage.interruptPreparingJobs();
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(app.jobs("w").find((j) => j.id === accepted.id)?.state).toBe("failed");
	expect(calls).toEqual([]);
	const legacy = storage.begin(identity, input.agent, ["a.ts"]);
	const restored = required(storage.jobs("w").find((j) => j.runId === legacy.id));
	expect(restored.id).toBe(`legacy:${legacy.id}`);
	expect(restored.startedAt).toBeNull();
	expect(restored.activity).toEqual([]);
});
test("superseded metadata attempt cannot launch or replace the newer job", async () => {
	const { app, storage, calls } = setup();
	let resolveFirst!: (value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void;
	let count = 0;
	app.deps.resolve = (i) =>
		++count === 1
			? new Promise((resolve) => {
					resolveFirst = resolve;
				})
			: Promise.resolve({ identity: i, changedFiles: ["a.ts"] });
	const first = app.startJob({ ...input, requestId: "one" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	const second = app.startJob({ ...input, requestId: "two" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	resolveFirst({ identity: { ...identity, headSha: "b".repeat(40) }, changedFiles: ["b.ts"] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(app.jobs("w").find((j) => j.id === first.id)?.state).toBe("superseded");
	expect(app.jobs("w").find((j) => j.id === second.id)?.state).toBe("running");
	expect(storage.peek(identity).identity.headSha).toBe(identity.headSha);
	expect(calls).toEqual(["start"]);
});
test("metadata timeout is bounded and late metadata cannot launch", async () => {
	const { app, calls } = setup();
	app.deps.metadataTimeoutMs = 5;
	let release!: (value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void;
	app.deps.resolve = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const job = app.startJob({ ...input, requestId: "timeout" });
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(app.jobs("w").find((j) => j.id === job.id)?.state).toBe("failed");
	release({ identity, changedFiles: ["a.ts"] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(calls).toEqual([]);
});
test("legacy failed run retry adopts stable tab identity without inventing old timestamps", async () => {
	const { app, storage } = setup();
	const run = storage.begin(identity, input.agent, ["a.ts"]);
	storage.fail(run, "interrupted");
	const job = app.startJob({ ...input, requestId: "legacy-retry", retryJobId: `legacy:${run.id}` });
	expect(job.id).toBe(`legacy:${run.id}`);
	expect(job.attempt).toBe(2);
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(app.jobs("w")).toHaveLength(1);
	expect(app.jobs("w")[0]?.runId).not.toBe(run.id);
});

test("cancelling preparation fences run authority before cleanup and rejects late terminal attachment", async () => {
	const { app, storage, runtime } = setup();
	let release!: (value: { terminalId: string }) => void;
	runtime.startMapping = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const job = app.startJob({ ...input, requestId: "prepare-cancel" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	const preparing = required(app.jobs("w")[0]);
	runtime.stopMapping = async ({ run }) => {
		expect(storage.getRun(run.id)?.state).toBe("cancelled");
	};
	await app.cancelJob("w", job.id);
	release({ terminalId: "late-terminal" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(storage.getRun(required(preparing.runId))?.terminalId).toBeUndefined();
	expect(app.jobs("w")[0]?.state).toBe("cancelled");
});
test("concurrent PR jobs retain their own scope while focus changes", async () => {
	const { app, runtime, sql } = setup();
	sql.exec("INSERT INTO workspaces VALUES ('w2')");
	app.deps.validateWorkspace = (i) => {
		if (!["w", "w2"].includes(i.workspaceId)) throw Error("wrong workspace");
	};
	const secondIdentity = { ...identity, workspaceId: "w2", prNumber: 2 };
	const launched: string[] = [];
	runtime.startMapping = async ({ run }) => {
		launched.push(`${run.identity.workspaceId}:${run.identity.prNumber}`);
		return { terminalId: `terminal-${run.identity.workspaceId}` };
	};
	const first = app.startJob({ ...input, requestId: "focus-one" });
	const second = app.startJob({ ...input, identity: secondIdentity, requestId: "focus-two" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(launched.sort()).toEqual(["w2:2", "w:1"]);
	expect(app.jobs("w")[0]?.id).toBe(first.id);
	expect(app.jobs("w2")[0]?.id).toBe(second.id);
	expect(app.jobs("w")[0]?.terminalId).toBe("terminal-w");
	expect(app.jobs("w2")[0]?.terminalId).toBe("terminal-w2");
});
test("stale renderer acceptance cannot revoke a verified newer mapping or its capability", async () => {
	const { app, storage, calls } = setup();
	const newer = { ...identity, headSha: "b".repeat(40) };
	const valid = app.startJob({ ...input, identity: newer, requestId: "verified-B" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	const active = required(app.jobs("w").find((job) => job.id === valid.id));
	const run = required(storage.getRun(required(active.runId)));
	const capability = storage.grantCapability(run);
	let release!: (value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void;
	app.deps.resolve = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	const stale = app.startJob({ ...input, requestId: "stale-A" });
	expect(storage.getRun(run.id)?.state).toBe("running");
	expect(storage.authenticateCapability(capability).id).toBe(run.id);
	await new Promise((resolve) => setTimeout(resolve, 0));
	release({ identity: newer, changedFiles: ["a.ts"] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(app.jobs("w").find((job) => job.id === stale.id)?.state).toBe("failed");
	expect(storage.getRun(run.id)?.state).toBe("running");
	expect(storage.authenticateCapability(capability).id).toBe(run.id);
	expect(calls).toEqual(["start"]);
});
for (const first of ["job", "read"] as const)
	test(`opening the same new head cannot fail its job (${first} resolves first)`, async () => {
		const { app, storage, calls } = setup();
		storage.get(identity);
		const next = { ...identity, headSha: "b".repeat(40) };
		const releases: Array<
			(value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void
		> = [];
		app.deps.resolve = () => new Promise((resolve) => releases.push(resolve));
		const job = app.startJob({ ...input, identity: next, requestId: `overlap-${first}` });
		await new Promise((resolve) => setTimeout(resolve, 0));
		const reading = app.get(next);
		const result = { identity: next, changedFiles: ["a.ts"] };
		required(releases[first === "job" ? 0 : 1])(result);
		await new Promise((resolve) => setTimeout(resolve, 0));
		required(releases[first === "job" ? 1 : 0])(result);
		await reading;
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(app.jobs("w").find((j) => j.id === job.id)?.state).toBe("running");
		expect(calls).toEqual(["start"]);
	});
test("newer provider observation remains authoritative after a same-head job joins its pending read", async () => {
	const { app, storage } = setup();
	storage.get(identity);
	const next = { ...identity, headSha: "b".repeat(40) };
	const latest = { ...identity, headSha: "c".repeat(40) };
	const releases: Array<(value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void> =
		[];
	app.deps.resolve = () => new Promise((resolve) => releases.push(resolve));
	const job = app.startJob({ ...input, identity: next, requestId: "pending-B-then-C" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	const reading = app.get(next);
	required(releases[0])({ identity: next, changedFiles: ["a.ts"] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(app.jobs("w").find((j) => j.id === job.id)?.state).toBe("running");
	required(releases[1])({ identity: latest, changedFiles: ["a.ts"] });
	await reading;
	expect(storage.peek(next).identity.headSha).toBe(latest.headSha);
	expect(app.jobs("w").find((j) => j.id === job.id)?.state).toBe("superseded");
});
test("a later pending stale read cannot authorize rollback of an already accepted newer head", async () => {
	const { app, storage, calls } = setup();
	storage.get(identity);
	const b = { ...identity, headSha: "b".repeat(40) };
	const c = { ...identity, headSha: "c".repeat(40) };
	const releases: Array<(value: { identity: ReviewPathIdentity; changedFiles: string[] }) => void> =
		[];
	app.deps.resolve = () => new Promise((resolve) => releases.push(resolve));
	const job = app.startJob({ ...input, identity: b, requestId: "old-job-B" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	const firstRead = app.get(b);
	required(releases[1])({ identity: c, changedFiles: ["a.ts"] });
	await firstRead;
	const laterRead = app.get(b);
	required(releases[0])({ identity: b, changedFiles: ["a.ts"] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(storage.peek(c).identity.headSha).toBe(c.headSha);
	expect(app.jobs("w").find((j) => j.id === job.id)?.state).toBe("failed");
	expect(calls).toEqual([]);
	required(releases[2])({ identity: c, changedFiles: ["a.ts"] });
	await laterRead;
});
test("only the current mapping receives measured progress; remapping preserves older job counts", async () => {
	const { app, storage } = setup();
	const first = app.startJob({ ...input, requestId: "progress-one" });
	expect(first.progress).toBeUndefined();
	await new Promise((resolve) => setTimeout(resolve, 10));
	const run = required(
		storage.getRun(required(app.jobs("w").find((j) => j.id === first.id)?.runId))
	);
	storage.addStep(run, "entry", "Entry", {
		id: "step",
		kind: "changed",
		path: "a.ts",
		note: "Entry point",
		focus: [],
		tests: [],
	});
	expect(app.jobs("w").find((j) => j.id === first.id)?.progress).toEqual({ placed: 1, total: 1 });
	const next = app.startJob({ ...input, requestId: "progress-two" });
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(app.jobs("w").find((j) => j.id === first.id)?.progress).toEqual({ placed: 1, total: 1 });
	expect(app.jobs("w").find((j) => j.id === next.id)?.progress).toEqual({ placed: 0, total: 1 });
	const legacy = storage.begin(identity, input.agent, ["a.ts", "b.ts"]);
	expect(app.jobs("w").find((j) => j.runId === legacy.id)?.progress).toEqual({
		placed: 0,
		total: 2,
	});
});
