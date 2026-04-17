import { describe, expect, test } from "bun:test";

test("useFileEditorLsp no longer reads the dismissed-languages query", async () => {
	const src = await Bun.file(
		new URL("../src/renderer/components/editor/useFileEditorLsp.ts", import.meta.url)
	).text();
	expect(src).not.toContain("getDismissedLanguages");
	expect(src).not.toContain("isDismissed");
});
