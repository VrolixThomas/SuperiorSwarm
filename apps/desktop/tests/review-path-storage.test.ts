import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { getDb } from "../src/main/db";
import * as schema from "../src/main/db/schema";
import { ReviewPathStorage } from "../src/main/review-path/storage";
import type { ReviewPathIdentity } from "../src/shared/review-path-runtime";

const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: "a".repeat(40),
};
const agent = { id: "codex", label: "Codex" };
function setup(filename = ":memory:") {
	const sqlite = new Database(filename);
	sqlite.exec(
		"CREATE TABLE workspaces (id TEXT PRIMARY KEY); INSERT INTO workspaces VALUES ('w'),('other');"
	);
	sqlite.exec(
		readFileSync(
			new URL("../src/main/db/migrations/0065_add_review_path_persistence.sql", import.meta.url),
			"utf8"
		)
	);
	const db = drizzle(sqlite, { schema }) as unknown as ReturnType<typeof getDb>;
	return { store: new ReviewPathStorage(db), db, sqlite };
}
const step = {
	id: "s",
	kind: "changed" as const,
	path: "src/a.ts",
	note: "Entry",
	focus: [{ side: "RIGHT" as const, startLine: 1, endLine: 2 }],
	tests: [{ path: "test.ts", changed: true }],
};
const content = { entries: [{ id: "entry", title: "Entry", steps: [step] }], otherFiles: [] };
function begin(store: ReviewPathStorage, id = identity) {
	return store.begin(id, agent, ["src/a.ts", "test.ts"]);
}

describe("durable reading paths", () => {
	test("round trips path, context, thread notes and conversations across storage restart", () => {
		const { store, db } = setup();
		const run = begin(store);
		store.setPath(run, content);
		store.setThreadNote(run, "t", { verdict: "unclear", text: "Check callers" });
		store.finish(run);
		store.addUserContext(identity, "entry", {
			id: "c",
			kind: "context",
			addedBy: "user",
			path: "context.ts",
			note: "",
			focus: [],
		});
		const q = store.enqueueQuestion(identity, { id: "q", text: "Why?" });
		store.answerQuestion(q.run, q.question.id, {
			text: "Because",
			refs: [{ path: "src/a.ts", line: 1, description: "entry" }],
		});
		const result = new ReviewPathStorage(db).get(identity);
		expect(result.path?.status).toBe("ready");
		expect(result.path?.entries[0]?.steps).toHaveLength(2);
		expect(result.path?.threadNotes?.["t"]?.text).toBe("Check callers");
		expect(result.messages.map((m) => m.text)).toEqual(["Why?", "Because"]);
	});
	test("rejects missing/duplicate coverage, unsafe paths, invalid ranges and wrong changed facts atomically", () => {
		const { store } = setup();
		const run = begin(store);
		for (const candidate of [
			{ ...content, otherFiles: ["test.ts"] },
			{ entries: [], otherFiles: [] },
			{
				entries: [{ id: "e", title: "x", steps: [{ ...step, path: "../escape" }] }],
				otherFiles: [],
			},
			{
				entries: [
					{
						id: "e",
						title: "x",
						steps: [{ ...step, focus: [{ side: "RIGHT", startLine: 3, endLine: 1 }] }],
					},
				],
				otherFiles: [],
			},
			{
				entries: [
					{
						id: "e",
						title: "x",
						steps: [{ ...step, tests: [{ path: "test.ts", changed: false }] }],
					},
				],
				otherFiles: ["test.ts"],
			},
		])
			expect(() => store.setPath(run, candidate)).toThrow();
		expect(store.get(identity).path?.entries).toEqual([]);
	});
	test("duplicate identical updates are idempotent; cancelled and completed runs reject delayed writes", () => {
		const { store } = setup();
		const run = begin(store);
		store.setPath(run, content);
		const version = store.get(identity).pathVersion;
		store.setPath(run, content);
		expect(store.get(identity).pathVersion).toBe(version);
		store.cancel(run);
		expect(() => store.setPath(run, content)).toThrow();
		const next = begin(store);
		expect(next.version).toBeGreaterThan(run.version);
		store.finish(next);
		expect(() => store.addStep(next, "e", "Entry", step)).toThrow();
	});
	test("head change marks stored path stale and permanently fences old runs", () => {
		const { store, db } = setup();
		const run = begin(store);
		store.setPath(run, content);
		const changed = { ...identity, headSha: "b".repeat(40) };
		expect(store.get(changed).path?.status).toBe("stale");
		expect(() => store.setPath(run, content)).toThrow();
		expect(new ReviewPathStorage(db).get(changed).path?.headSha).toBe(identity.headSha);
	});
	test("two providers and workspaces never share paths or accept each other's writes", () => {
		const { store } = setup();
		const run = begin(store);
		store.setPath(run, content);
		for (const other of [
			{ ...identity, provider: "bitbucket" as const },
			{ ...identity, workspaceId: "other" },
		]) {
			expect(store.get(other).path).toBeNull();
			expect(() => store.setPath({ ...run, identity: other }, content)).toThrow();
		}
	});
	test("two questions correlate out-of-order replies; cancellation and remapping fence answers", () => {
		const { store } = setup();
		const run = begin(store);
		store.finish(run);
		const one = store.enqueueQuestion(identity, { id: "one", text: "One" });
		const two = store.enqueueQuestion(identity, { id: "two", text: "Two" });
		expect(() => store.answerQuestion(one.run, two.question.id, { text: "wrong" })).toThrow();
		store.answerQuestion(two.run, two.question.id, { text: "second" });
		store.answerQuestion(one.run, one.question.id, { text: "first" });
		expect(store.get(identity).questions.map((q) => q.answer?.text)).toEqual(["first", "second"]);
		const cancelled = store.enqueueQuestion(identity, { id: "cancel", text: "cancel" });
		store.cancel(cancelled.run);
		expect(() => store.answerQuestion(cancelled.run, "cancel", { text: "late" })).toThrow();
		const old = store.enqueueQuestion(identity, { id: "old", text: "old" });
		begin(store);
		expect(() => store.answerQuestion(old.run, "old", { text: "late" })).toThrow();
	});
});

test("user context survives streamed replacement and remapping; conversations remain durable", () => {
	const { store, db } = setup();
	const run = begin(store);
	store.setPath(run, content);
	store.addUserContext(identity, "entry", {
		id: "user-context",
		kind: "context",
		addedBy: "user",
		path: "context.ts",
		note: "local",
		focus: [],
	});
	store.setPath(run, content);
	expect(
		store
			.get(identity)
			.path?.entries.flatMap((e) => e.steps)
			.some((s) => s.id === "user-context")
	).toBe(true);
	store.finish(run);
	const q = store.enqueueQuestion(identity, { id: "history", text: "Keep this" });
	store.answerQuestion(q.run, q.question.id, { text: "Kept" });
	begin(store);
	const restarted = new ReviewPathStorage(db).get(identity);
	expect(restarted.questions.some((q) => q.id === "history")).toBe(true);
	expect(restarted.path?.entries.flatMap((e) => e.steps).some((s) => s.id === "user-context")).toBe(
		true
	);
});

test("automatic mapping claims persist once per exact provider/PR/head and settings import never overrides explicit settings", () => {
	const { store, db } = setup();
	const auto = store.begin(identity, agent, ["src/a.ts"], { auto: true });
	store.cancel(auto);
	expect(new ReviewPathStorage(db).begin(identity, agent, ["src/a.ts"], { auto: true }).id).toBe(
		auto.id
	);
	expect(
		store.begin({ ...identity, headSha: "b".repeat(40) }, agent, ["src/a.ts"], { auto: true }).id
	).not.toBe(auto.id);
	const settings = {
		autoMapOnReviewRequest: true,
		alsoReview: false,
		defaultRailMode: "files" as const,
	};
	store.updateSettings(settings);
	expect(
		new ReviewPathStorage(db).importLegacySettings({
			autoMapOnReviewRequest: false,
			alsoReview: true,
			defaultRailMode: "auto",
		})
	).toEqual(settings);
});

test("agent cannot impersonate or overwrite user-added context", () => {
	const { store } = setup();
	const run = begin(store);
	store.setPath(run, content);
	const context = {
		id: "user",
		kind: "context" as const,
		addedBy: "user" as const,
		path: "context.ts",
		note: "local",
		focus: [],
	};
	expect(() =>
		store.setPath(run, {
			entries: [{ id: "entry", title: "Entry", steps: [step, context] }],
			otherFiles: [],
		})
	).toThrow();
	store.addUserContext(identity, "entry", context);
	expect(() =>
		store.setPath(run, {
			entries: [{ id: "entry", title: "Entry", steps: [step, { ...context, note: "rewritten" }] }],
			otherFiles: [],
		})
	).toThrow();
	store.setThreadNote(run, "thread", { verdict: "unclear", text: "note" });
	const version = store.get(identity).pathVersion;
	store.setThreadNote(run, "thread", { verdict: "unclear", text: "note" });
	expect(store.get(identity).pathVersion).toBe(version);
});

test("closed database reopens with durable path, capability and question correlations", () => {
	const dir = mkdtempSync(join(tmpdir(), "review-path-storage-"));
	const file = join(dir, "state.db");
	try {
		const { store, sqlite } = setup(file);
		const run = begin(store);
		store.setPath(run, content);
		store.finish(run);
		const pending = store.enqueueQuestion(identity, { id: "disk-question", text: "Persist?" });
		const capability = store.grantCapability(pending.run);
		sqlite.close();
		const reopened = new Database(file);
		try {
			const restored = new ReviewPathStorage(
				drizzle(reopened, { schema }) as unknown as ReturnType<typeof getDb>
			);
			const authorized = restored.authenticateCapability(capability);
			for (const wrong of [
				{ ...identity, workspaceId: "other" },
				{ ...identity, provider: "bitbucket" as const },
				{ ...identity, prNumber: 2 },
				{ ...identity, headSha: "c".repeat(40) },
			])
				expect(() =>
					restored.answerQuestion({ ...authorized, identity: wrong }, "disk-question", {
						text: "wrong",
					})
				).toThrow();
			restored.answerQuestion(authorized, "disk-question", { text: "Persisted" });
			expect(restored.peek(identity).questions[0]?.answer?.text).toBe("Persisted");
			expect(restored.peek(identity).path?.headSha).toBe(identity.headSha);
		} finally {
			reopened.close();
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
