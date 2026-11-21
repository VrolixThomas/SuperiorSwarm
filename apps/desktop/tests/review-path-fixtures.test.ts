import { expect, test } from "bun:test";
import {
	PR129_FILES,
	PR129_MAPPING_FRAMES,
	PR129_PATH,
} from "../src/renderer/lib/review-path-fixtures";

test("fixture covers each changed file once, with eight steps, five tests and context", () => {
	const steps = PR129_PATH.entries.flatMap((entry) => entry.steps);
	const changed = steps.filter((step) => step.kind === "changed");
	const paths = [
		...changed.flatMap((step) => [
			step.path,
			...step.tests.filter((test) => test.changed).map((test) => test.path),
		]),
		...PR129_PATH.otherFiles,
	];
	expect(changed).toHaveLength(8);
	expect(changed.flatMap((step) => step.tests)).toHaveLength(5);
	expect(steps.filter((step) => step.kind === "context")).toHaveLength(1);
	expect(new Set(paths).size).toBe(paths.length);
	expect(paths.sort()).toEqual(PR129_FILES.map((file) => file.path).sort());
	expect(new Set(steps.map((step) => step.id)).size).toBe(steps.length);
	for (const step of steps)
		for (const focus of step.focus) expect(focus.startLine).toBeLessThanOrEqual(focus.endLine);
	expect(PR129_MAPPING_FRAMES.at(-1)).toEqual(PR129_PATH);
});
