import { expect, test } from "bun:test";
import { PR129_FILES, PR129_PATH } from "../src/renderer/lib/review-path-fixtures";
import {
	countsByPath,
	coverage,
	folderGroups,
	isStale,
	numberSteps,
	railItems,
	selectableRailItems,
	stepForPath,
	stepLabel,
	viewedProgress,
} from "../src/renderer/lib/review-path-model";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing fixture value");
	return value;
}

test("path order nests tests and context without numbering them", () => {
	const items = selectableRailItems(railItems(PR129_PATH, PR129_FILES, "path"));
	expect(items.slice(0, 4).map((item) => item.kind)).toEqual(["step", "step", "test", "step"]);
	expect(numberSteps(PR129_PATH).get("review-mode")).toBe(8);
	expect(numberSteps(PR129_PATH).has("provider-context")).toBe(false);
	expect(stepLabel(PR129_PATH, required(items[3]), "path")).toBe("Step 3 of 8");
	expect(stepLabel({ ...PR129_PATH, status: "mapping" }, required(items[3]), "path")).toBe(
		"Step 3"
	);
	expect(stepForPath(PR129_PATH, required(items[3]).path)?.id).toBe("ai-review");
});
test("coverage reports duplicate and missing files and missing files remain reachable", () => {
	const path = { ...PR129_PATH, otherFiles: ["CLAUDE.md", "CLAUDE.md"] };
	expect(coverage(path, PR129_FILES).duplicated).toEqual(["CLAUDE.md"]);
	expect(coverage(path, PR129_FILES).missing).toHaveLength(3);
	expect(selectableRailItems(railItems(path, PR129_FILES, "path"))).toHaveLength(18);
});
test("folder groups retain provider order within folders, progress excludes context", () => {
	const files = [{ path: "z/b" }, { path: "a/c" }, { path: "z/a" }];
	expect(folderGroups(files).map((group) => group.files.map((file) => file.path))).toEqual([
		["z/b", "z/a"],
		["a/c"],
	]);
	expect(viewedProgress(PR129_FILES, new Set(["CLAUDE.md", "context-file"]))).toEqual({
		viewed: 1,
		total: 17,
	});
	expect(coverage(PR129_PATH, PR129_FILES)).toEqual({ missing: [], duplicated: [] });
	expect(isStale(PR129_PATH, "another-head")).toBe(true);
});
test("thread and finding counts remain independent", () => {
	const counts = countsByPath([
		{ id: "t", path: "a", line: 1, diffSide: "RIGHT", isResolved: false, comments: [] },
		{ id: "r", path: "a", line: 1, diffSide: "RIGHT", isResolved: true, comments: [] },
		{
			id: "f",
			path: "a",
			line: 1,
			diffSide: "RIGHT",
			isAIDraft: true,
			draftCommentId: "f",
			body: "finding",
			status: "pending",
			userEdit: null,
			createdAt: "",
		},
	]);
	expect(counts.get("a")).toEqual({ openThreads: 1, pendingFindings: 1 });
});

test("a formerly unchanged context or test remains reachable as a changed file", () => {
	const context = required(
		required(PR129_PATH.entries[0]).steps.find((step) => step.kind === "context")
	);
	const path = {
		...PR129_PATH,
		entries: PR129_PATH.entries.map((entry) => ({
			...entry,
			steps: entry.steps.map((step) =>
				step.kind === "changed"
					? { ...step, tests: step.tests.map((test) => ({ ...test, changed: false })) }
					: step
			),
		})),
	};
	const items = selectableRailItems(
		railItems(path, [...PR129_FILES, { path: context.path }], "path")
	);
	expect(items.find((item) => item.path === context.path)).toMatchObject({
		kind: "file",
		changed: true,
	});
	expect(items.filter((item) => item.kind === "test").every((item) => item.changed)).toBe(true);
	expect(items.filter((item) => item.changed)).toHaveLength(18);
});

test("unmapped files are alphabetical with folder labels and share keyboard order", () => {
	const files = [{ path: "src/z.ts" }, { path: "lib/a.ts" }, { path: "test/b.ts" }];
	const items = selectableRailItems(railItems(null, files, "files"));
	expect(items.map((item) => item.path)).toEqual(["lib/a.ts", "test/b.ts", "src/z.ts"]);
	expect(items[0]?.folderLabel).toBe("lib");
});
