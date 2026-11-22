import { expect, test } from "bun:test";
import { PR129_PATH } from "../src/renderer/lib/review-path-fixtures";
import {
	addContextStep,
	applyMappingFrame,
	getReviewPath,
	removeContextStep,
	reviewPathRegistryKey,
} from "../src/renderer/lib/review-path-source";
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture value");
	return value;
}
const pr = {
	provider: "github" as const,
	owner: "other",
	repo: "repo",
	number: 129,
	title: "",
	sourceBranch: "",
	targetBranch: "",
	repoPath: "",
};
test("live PR 129 never implicitly resolves to illustrative data", () => {
	expect(getReviewPath(pr)).toBeNull();
	expect(getReviewPath(pr, true)?.id).toBe(PR129_PATH.id);
	expect(reviewPathRegistryKey(pr)).not.toBe(
		reviewPathRegistryKey({ ...pr, provider: "bitbucket" })
	);
});
test("mapping frames preserve placed order and file identity", () => {
	const initial = {
		...PR129_PATH,
		entries: [
			{
				...required(PR129_PATH.entries[0]),
				steps: required(PR129_PATH.entries[0]).steps.slice(0, 2),
			},
		],
	};
	const incoming = {
		...PR129_PATH,
		entries: [
			{
				...required(PR129_PATH.entries[0]),
				steps: [...required(PR129_PATH.entries[0]).steps].reverse(),
			},
			required(PR129_PATH.entries[1]),
		],
	};
	const result = applyMappingFrame(initial, incoming);
	expect(
		required(result.entries[0])
			.steps.slice(0, 2)
			.map((step) => step.id)
	).toEqual(["submit-popover", "submit"]);
	expect(required(initial.entries[0]).steps).toHaveLength(2);
});
test("user context insertion and removal cannot remove changed steps", () => {
	const next = addContextStep(PR129_PATH, "submit", "submit", "src/context.ts");
	expect(required(next.entries[0]).steps[2]).toMatchObject({
		kind: "context",
		path: "src/context.ts",
		addedBy: "user",
	});
	expect(removeContextStep(next, required(required(next.entries[0]).steps[2]).id)).toEqual(
		PR129_PATH
	);
	expect(removeContextStep(PR129_PATH, "submit")).toEqual(PR129_PATH);
});
