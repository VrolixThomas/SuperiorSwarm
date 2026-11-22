import { expect, test } from "bun:test";
import { classifyPRFeedback } from "../src/main/activity-queue/pr-feedback";
import { type QueuePRReviewEvidence, evaluateQueuePRReview } from "../src/shared/queue-pr";
const evidence: QueuePRReviewEvidence = {
	headSha: "new",
	viewerId: "me",
	reviewId: "review",
	reviewedSha: "old",
	reviewState: "CHANGES_REQUESTED",
	threadsComplete: true,
	ownThreads: [{ path: "a.ts", resolved: true }],
	comparison: "ahead",
	comparisonBase: "old",
	filesComplete: true,
	changedFiles: ["a.ts"],
	ciComplete: true,
	ciPassing: true,
	open: true,
	draft: false,
};
test("eligibility is evidence, not semantic proof", () => {
	const result = evaluateQueuePRReview(evidence);
	expect(result.eligible).toBe(true);
	expect(result.evidence.at(-1)).toContain("do not prove");
});
for (const patch of [
	{ reviewState: "APPROVED" },
	{ threadsComplete: false },
	{ ownThreads: [{ path: "a.ts", resolved: false }] },
	{ comparison: "diverged" as const },
	{ comparisonBase: "elsewhere" },
	{ filesComplete: false },
	{ changedFiles: ["other.ts"] },
	{ ciComplete: false },
	{ ciPassing: false },
	{ open: false },
	{ draft: true },
	{ ownThreads: [] },
])
	test(`ineligible ${JSON.stringify(patch)}`, () =>
		expect(evaluateQueuePRReview({ ...evidence, ...patch }).eligible).toBe(false));
const event = { id: "one", authorId: "other", author: "Other", body: "Please address this", at: 1 };
test("feedback silently baselines and suppresses self/duplicates", () => {
	const first = classifyPRFeedback(undefined, [event], "me", false);
	expect(first.pending).toEqual([]);
	const next = classifyPRFeedback(
		first,
		[event, { ...event, id: "self", authorId: "me" }, { ...event, id: "two" }],
		"me",
		false
	);
	expect(next.pending.map((e) => e.id)).toEqual(["two"]);
	expect(
		classifyPRFeedback(next, [event, { ...event, id: "two" }], "me", false).pending
	).toHaveLength(1);
});
test("Done and resolution retire only their feedback, new events return", () => {
	const baseline = classifyPRFeedback(undefined, [], "me", false);
	const next = classifyPRFeedback(baseline, [event], "me", false);
	expect(classifyPRFeedback(next, [event], "me", true).pending).toEqual([]);
	expect(classifyPRFeedback(next, [{ ...event, resolved: true }], "me", false).pending).toEqual([]);
	const done = classifyPRFeedback(next, [event], "me", true);
	expect(
		classifyPRFeedback(done, [event, { ...event, id: "new" }], "me", false).pending.map((e) => e.id)
	).toEqual(["new"]);
});
test("pending feedback text updates and resolved threads can reopen", () => {
	const base = classifyPRFeedback(undefined, [], "me", false);
	const pending = classifyPRFeedback(base, [event], "me", false);
	expect(
		classifyPRFeedback(pending, [{ ...event, body: "Updated request" }], "me", false).pending[0]
			?.body
	).toBe("Updated request");
	const resolved = classifyPRFeedback(pending, [{ ...event, resolved: true }], "me", false);
	expect(classifyPRFeedback(resolved, [event], "me", false).pending[0]?.id).toBe(event.id);
});
