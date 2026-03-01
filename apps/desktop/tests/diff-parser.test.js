import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/main/git/operations";
const MODIFIED_FILE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,4 +1,5 @@
 line 1
-line 2 old
+line 2 new
+line 2.5
 line 3
 line 4
`;
const NEW_FILE_DIFF = `diff --git a/src/bar.ts b/src/bar.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/bar.ts
@@ -0,0 +1,3 @@
+new line 1
+new line 2
+new line 3
`;
const DELETED_FILE_DIFF = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-gone line 1
-gone line 2
`;
const RENAMED_FILE_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index abc1234..def5678 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 line 1
-old content
+new content
 line 3
`;
describe("parseUnifiedDiff", () => {
    test("returns empty array for empty input", () => {
        expect(parseUnifiedDiff("")).toEqual([]);
        expect(parseUnifiedDiff("   ")).toEqual([]);
    });
    test("parses a modified file", () => {
        const files = parseUnifiedDiff(MODIFIED_FILE_DIFF);
        expect(files).toHaveLength(1);
        const file = files[0];
        expect(file.path).toBe("src/foo.ts");
        expect(file.status).toBe("modified");
        expect(file.additions).toBe(2);
        expect(file.deletions).toBe(1);
        expect(file.hunks).toHaveLength(1);
    });
    test("parses hunk lines correctly", () => {
        const files = parseUnifiedDiff(MODIFIED_FILE_DIFF);
        const hunk = files[0].hunks[0];
        const addedLines = hunk.lines.filter((l) => l.type === "added");
        const removedLines = hunk.lines.filter((l) => l.type === "removed");
        const contextLines = hunk.lines.filter((l) => l.type === "context");
        expect(addedLines).toHaveLength(2);
        expect(removedLines).toHaveLength(1);
        expect(contextLines).toHaveLength(3);
    });
    test("parses an added file", () => {
        const files = parseUnifiedDiff(NEW_FILE_DIFF);
        expect(files).toHaveLength(1);
        const file = files[0];
        expect(file.path).toBe("src/bar.ts");
        expect(file.status).toBe("added");
        expect(file.additions).toBe(3);
        expect(file.deletions).toBe(0);
        expect(file.oldPath).toBeUndefined();
    });
    test("parses a deleted file", () => {
        const files = parseUnifiedDiff(DELETED_FILE_DIFF);
        expect(files).toHaveLength(1);
        const file = files[0];
        expect(file.path).toBe("src/old.ts");
        expect(file.status).toBe("deleted");
        expect(file.additions).toBe(0);
        expect(file.deletions).toBe(2);
    });
    test("parses a renamed file", () => {
        const files = parseUnifiedDiff(RENAMED_FILE_DIFF);
        expect(files).toHaveLength(1);
        const file = files[0];
        expect(file.path).toBe("src/new-name.ts");
        expect(file.oldPath).toBe("src/old-name.ts");
        expect(file.status).toBe("renamed");
    });
    test("parses multiple files", () => {
        const files = parseUnifiedDiff(MODIFIED_FILE_DIFF + NEW_FILE_DIFF);
        expect(files).toHaveLength(2);
    });
    test("assigns correct line numbers", () => {
        const files = parseUnifiedDiff(MODIFIED_FILE_DIFF);
        const hunk = files[0].hunks[0];
        const firstContext = hunk.lines.find((l) => l.type === "context");
        expect(firstContext.oldLineNumber).toBe(1);
        expect(firstContext.newLineNumber).toBe(1);
        const removed = hunk.lines.find((l) => l.type === "removed");
        expect(removed.oldLineNumber).toBe(2);
        const added = hunk.lines.find((l) => l.type === "added");
        expect(added.newLineNumber).toBe(2);
    });
});
