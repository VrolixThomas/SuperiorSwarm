import { afterEach, expect, test } from "bun:test";
import type { ContextFileStep, ReviewPathStep } from "../src/shared/review-path-types";
import { agent, authorityFixture, identity } from "./helpers/review-path-authority-fixture";
const fixtures: ReturnType<typeof authorityFixture>[] = [];
afterEach(() => {
	for (const f of fixtures.splice(0)) f.close();
});
const user: ContextFileStep = {
	id: "user",
	kind: "context",
	addedBy: "user",
	path: "context.ts",
	note: "My reasoning",
	detail: "My detail",
	focus: [{ side: "RIGHT", startLine: 3, endLine: 4 }],
	alsoIn: ["related"],
	usedBy: [{ path: "a.ts", line: 2, description: "My reference" }],
};
const changed = {
	id: "a",
	kind: "changed" as const,
	path: "a.ts",
	note: "Entry",
	focus: [],
	tests: [],
};
function setup() {
	const f = authorityFixture();
	fixtures.push(f);
	const run = f.storage.begin(identity, agent, ["a.ts"]);
	f.storage.setPath(run, {
		entries: [
			{ id: "entry", title: "User flow", steps: [changed] },
			{ id: "related", title: "Related flow", steps: [] },
		],
		otherFiles: [],
	});
	f.storage.addUserContext(identity, "entry", user);
	return { ...f, run };
}
for (const replacement of [
	{ ...user, id: "fresh", addedBy: "agent" },
	{ ...changed, id: "fresh", path: user.path },
	{ ...changed, tests: [{ path: user.path, changed: false }] },
	{ ...user, id: "fresh", addedBy: "user" },
	{ ...user, note: "Changed note" },
	{ ...user, focus: [] },
	{ ...user, path: "another.ts" },
])
	test(`replacement rejects ownership collision ${JSON.stringify(replacement)}`, () => {
		const f = setup();
		const before = f.storage.peek(identity);
		expect(() =>
			f.storage.setPath(f.run, {
				entries: [
					{ id: "entry", title: "User flow", steps: [replacement] },
					{ id: "related", title: "Related flow", steps: [] },
				],
				otherFiles: replacement.kind === "changed" && replacement.path === "a.ts" ? [] : ["a.ts"],
			})
		).toThrow();
		expect(f.storage.peek(identity)).toEqual(before);
	});

test("replacement and remapping retain the complete user record and its entry/reference semantics", () => {
	const f = setup();
	f.storage.setPath(f.run, {
		entries: [{ id: "new", title: "New agent flow", steps: [changed] }],
		otherFiles: [],
	});
	for (let i = 0; i < 2; i++) {
		const path = f.storage.peek(identity).path;
		if (!path) throw Error("Missing path");
		expect(path.entries.find((e) => e.id === "entry")).toEqual({
			id: "entry",
			title: "User flow",
			steps: [user],
		});
		expect(path.entries.find((e) => e.id === "related")?.title).toBe("Related flow");
		if (i === 0) f.storage.begin(identity, agent, ["a.ts"]);
	}
});

test("agent cannot move identical context into another entry or rename its entry", () => {
	const f = setup();
	const before = f.storage.peek(identity);
	for (const entry of [
		{ id: "moved", title: "User flow", steps: [user] },
		{ id: "entry", title: "Rewritten flow", steps: [user] },
	]) {
		expect(() =>
			f.storage.setPath(f.run, {
				entries: [entry, { id: "related", title: "Related flow", steps: [] }],
				otherFiles: ["a.ts"],
			})
		).toThrow();
		expect(f.storage.peek(identity)).toEqual(before);
	}
});

test("stream updates and user additions cannot introduce duplicate ownership; removal explicitly releases it", () => {
	const f = setup();
	const before = f.storage.peek(identity);
	const replacements: ReviewPathStep[] = [
		{ ...user, id: "fresh", addedBy: "agent" },
		{ ...user, id: "fresh", addedBy: "user" },
		{ ...changed, id: "fresh", path: "b.ts", tests: [{ path: user.path, changed: false }] },
	];
	for (const replacement of replacements) {
		expect(() => f.storage.addStep(f.run, "new", "New", replacement)).toThrow();
		expect(f.storage.peek(identity)).toEqual(before);
	}
	for (const replacement of [
		{ ...user, id: "fresh" },
		{ ...user, path: "another.ts" },
	]) {
		expect(() => f.storage.addUserContext(identity, "entry", replacement)).toThrow();
		expect(f.storage.peek(identity)).toEqual(before);
	}
	f.storage.removeUserContext(identity, user.id);
	f.storage.addStep(f.run, "entry", "User flow", { ...user, id: "fresh", addedBy: "agent" });
	expect(
		f.storage
			.peek(identity)
			.path?.entries.flatMap((e) => e.steps)
			.some((s) => s.id === user.id)
	).toBe(false);
});

test("remapping when user context becomes changed rejects atomically rather than losing user data", () => {
	const f = setup();
	const before = f.storage.peek(identity);
	expect(() =>
		f.storage.begin({ ...identity, headSha: "b".repeat(40) }, agent, ["a.ts", user.path])
	).toThrow();
	expect(f.storage.peek(identity)).toEqual(before);
});

test("user can remove retained stale context before remapping a newly changed file", () => {
	const f = setup();
	const next = { ...identity, headSha: "b".repeat(40) };
	f.storage.get(next);
	expect(() => f.storage.removeUserContext(identity, user.id)).toThrow();
	f.storage.removeUserContext(next, user.id);
	const run = f.storage.begin(next, agent, ["a.ts", user.path]);
	f.storage.setPath(run, {
		entries: [
			{
				id: "entry",
				title: "Changed flow",
				steps: [changed, { ...changed, id: "context-now-changed", path: user.path }],
			},
		],
		otherFiles: [],
	});
	expect(f.storage.peek(next).path?.entries[0]?.steps[1]?.kind).toBe("changed");
});
