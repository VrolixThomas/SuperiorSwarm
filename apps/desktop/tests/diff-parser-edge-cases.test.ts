import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/main/git/operations";

describe("parseUnifiedDiff edge cases", () => {
	test("handles backslash lines (no newline at end of file)", () => {
		const DIFF = `diff --git a/test.txt b/test.txt
index abc1234..def5678 100644
--- a/test.txt
+++ b/test.txt
@@ -1,2 +1,2 @@
 line 1
-line 2
\\ No newline at end of file
+line 2 modified
\\ No newline at end of file
`;
		const files = parseUnifiedDiff(DIFF);
		expect(files).toHaveLength(1);
		const file = files[0]!;
		expect(file.path).toBe("test.txt");
		expect(file.status).toBe("modified");
		expect(file.additions).toBe(1);
		expect(file.deletions).toBe(1);
		
		const hunk = file.hunks[0]!;
		const contextLines = hunk.lines.filter(l => l.type === "context");
		const addedLines = hunk.lines.filter(l => l.type === "added");
		const removedLines = hunk.lines.filter(l => l.type === "removed");
		
		// Should have 1 context line "line 1", 1 removed "line 2", 1 added "line 2 modified"
		// The backslash lines should NOT be counted as context lines
		expect(contextLines).toHaveLength(1);
		expect(removedLines).toHaveLength(1);
		expect(addedLines).toHaveLength(1);
		expect(contextLines[0]!.content).toBe("line 1");
	});

	test("handles blank lines in diffs", () => {
		const DIFF = `diff --git a/test.txt b/test.txt
index abc1234..def5678 100644
--- a/test.txt
+++ b/test.txt
@@ -1,4 +1,4 @@
 line 1

 line 3
-old line
+new line
`;
		const files = parseUnifiedDiff(DIFF);
		expect(files).toHaveLength(1);
		const hunk = files[0]!.hunks[0]!;
		// Should have context lines for "line 1", blank line, "line 3", plus 1 added and 1 removed
		expect(hunk.lines.length).toBeGreaterThan(2);
	});
});
