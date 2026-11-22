import { describe, expect, test } from "bun:test";
import { classifyPR, readPRSnapshot } from "../src/main/activity-queue/pr-classification";
const facts = {
	state: "open" as const,
	headSha: "a",
	isDraft: false,
	reviewRequested: false,
	reviewToken: "r0",
	commentToken: "c0",
};
describe("PR activity classification", () => {
	test("first baseline has no fake update; explicit request is immediately actionable", () => {
		expect(classifyPR(undefined, facts, [], 1).kind).toBeUndefined();
		expect(classifyPR(undefined, { ...facts, reviewRequested: true }, [], 1).reasons).toEqual([
			"Review requested",
		]);
	});
	test("draft and unknown draft suppress remote request", () => {
		expect(
			classifyPR(undefined, { ...facts, isDraft: true, reviewRequested: true }, [], 1).kind
		).toBeUndefined();
		expect(
			classifyPR(undefined, { state: "open", reviewRequested: true }, [], 1).kind
		).toBeUndefined();
	});
	test("unchanged polls preserve fingerprint/time; meaningful head/review/comment/request changes alter it", () => {
		const a = classifyPR(undefined, facts, [], 1);
		expect(classifyPR(a.snapshot, facts, [], 2).fingerprint).toBe(a.fingerprint);
		expect(classifyPR(a.snapshot, facts, [], 2).snapshot.occurredAt).toBe(1);
		for (const changed of [
			{ headSha: "b" },
			{ reviewToken: "r1" },
			{ commentToken: "c1" },
			{ reviewRequested: true },
		]) {
			const b = classifyPR(a.snapshot, { ...facts, ...changed }, [], 3);
			expect(b.fingerprint).not.toBe(a.fingerprint);
			expect(b.snapshot.occurredAt).toBe(3);
			expect(b.kind).toBeDefined();
		}
	});
	test("enrichment loss preserves head/request and update; newly learned fields baseline silently", () => {
		const a = classifyPR(
			undefined,
			{ state: "open", isDraft: false, reviewRequested: true },
			[],
			1
		);
		const b = classifyPR(a.snapshot, { headSha: "a" }, [], 2);
		expect(b.reasons).toEqual(["Review requested"]);
		const c = classifyPR(b.snapshot, { headSha: "" }, [], 3);
		expect(c.fingerprint).toBe(b.fingerprint);
		expect(c.snapshot.headSha).toBe("a");
		expect(c.snapshot.reviewRequested).toBe(true);
	});
	test("explicit closure clears pending work; errors are not closure", () => {
		const a = classifyPR(undefined, { ...facts, reviewRequested: true }, [], 1);
		expect(classifyPR(a.snapshot, {}, [], 2).kind).toBe("pr-review");
		expect(classifyPR(a.snapshot, { state: "merged" }, ["draft"], 2).kind).toBeUndefined();
	});
	test("local ready draft is labelled accurately and removal clears it", () => {
		const a = classifyPR(undefined, facts, ["manual-draft"], 1);
		expect(a.reasons).toEqual(["Review draft ready"]);
		expect(classifyPR(a.snapshot, facts, [], 2).kind).toBeUndefined();
	});
	test("rejects invalid persisted snapshots", () => {
		expect(readPRSnapshot({ version: 1 })).toBeUndefined();
		const a = classifyPR(undefined, facts, [], 1).snapshot;
		expect(readPRSnapshot(a)).toEqual(a);
		expect(readPRSnapshot({ ...a, reviewRequested: "false" })).toBeUndefined();
	});
});
