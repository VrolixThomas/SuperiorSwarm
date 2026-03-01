import { describe, expect, test } from "bun:test";
import { parseUnifiedDiff } from "../src/main/git/operations";

describe("debug backslash lines", () => {
	test("examine backslash line handling", () => {
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
		const hunk = files[0]!.hunks[0]!;
		console.log("Total lines in hunk:", hunk.lines.length);
		console.log(
			"Line types:",
			hunk.lines.map((l, i) => `[${i}] ${l.type}: "${l.content}"`)
		);
	});
});
