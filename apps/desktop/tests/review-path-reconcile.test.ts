import { expect, test } from "bun:test";
import { reconcileReviewPathRuns } from "../src/main/review-path/execution";
import type { ReviewPathRun } from "../src/shared/review-path-runtime";
const run: ReviewPathRun = {
	id: "one",
	version: 1,
	kind: "mapping",
	state: "running",
	conversationId: "c",
	terminalId: "review-path:one:1",
	identity: {
		workspaceId: "ws",
		provider: "github",
		owner: "o",
		repo: "r",
		prNumber: 1,
		headSha: "a".repeat(40),
	},
};
test("restart preserves surviving owned terminal and fails missing run without relaunch", () => {
	const failed: string[] = [];
	reconcileReviewPathRuns(
		[run, { ...run, id: "two", terminalId: "review-path:two:1" }],
		["review-path:one:1"],
		(_run, error) => failed.push(error)
	);
	expect(failed).toHaveLength(1);
	expect(failed[0]).toContain("interrupted");
});
test("restart rejects foreign terminal ownership", () => {
	const failed: string[] = [];
	reconcileReviewPathRuns([{ ...run, terminalId: "unrelated" }], ["unrelated"], (_run, e) =>
		failed.push(e)
	);
	expect(failed).toHaveLength(1);
});
