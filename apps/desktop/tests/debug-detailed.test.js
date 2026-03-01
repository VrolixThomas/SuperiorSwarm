import { describe, test } from "bun:test";
import { parseUnifiedDiff } from "../src/main/git/operations";
describe("detailed backslash line inspection", () => {
	test("examine exact diff parsing", () => {
		// Simulating exactly what a real diff looks like with backslash lines
		const rawDiff = `diff --git a/test.txt b/test.txt
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
		console.log("Raw diff:");
		console.log(JSON.stringify(rawDiff));
		console.log("\nLines in raw diff:");
		rawDiff.split("\n").forEach((line, i) => {
			console.log(`[${i}] ${JSON.stringify(line)}`);
		});
		const files = parseUnifiedDiff(rawDiff);
		const hunk = files[0].hunks[0];
		console.log("\nParsed hunk lines:");
		hunk.lines.forEach((line, i) => {
			console.log(
				`[${i}] type=${line.type}, content="${line.content}", old=${line.oldLineNumber}, new=${line.newLineNumber}`
			);
		});
	});
});
