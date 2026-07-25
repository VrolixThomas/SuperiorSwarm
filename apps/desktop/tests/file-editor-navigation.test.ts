import { expect, test } from "bun:test";

async function readFileEditorSource(): Promise<string> {
	return await Bun.file(
		new URL("../src/renderer/components/FileEditor.tsx", import.meta.url)
	).text();
}

test("FileEditor reacts to new initialPosition props after mount", async () => {
	const src = await readFileEditorSource();
	expect(src).toContain("pendingInitialPositionRef");
	expect(src).toMatch(
		/useEffect\(\(\) => \{\s*if \(!initialPosition\) return;\s*pendingInitialPositionRef\.current = initialPosition;\s*applyPendingInitialPosition\(\);/s
	);
});
