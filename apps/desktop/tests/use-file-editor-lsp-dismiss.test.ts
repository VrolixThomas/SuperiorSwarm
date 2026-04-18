import { expect, test } from "bun:test";

async function readHookSource(): Promise<string> {
	return await Bun.file(
		new URL("../src/renderer/components/editor/useFileEditorLsp.ts", import.meta.url)
	).text();
}

test("useFileEditorLsp no longer reads the dismissed-languages query", async () => {
	const src = await readHookSource();
	expect(src).not.toContain("getDismissedLanguages");
	expect(src).not.toContain("isDismissed");
});

test("useFileEditorLsp public signature takes exactly (model, repoPath, language, filePath)", async () => {
	// We can't `import()` the hook at runtime in bun:test because it transitively
	// pulls in monaco-editor, which touches `window` at module top-level. So we
	// pin the signature by parsing the source instead. This is strictly stronger
	// than `fn.length === 4`: it fixes both arity and parameter names, so a
	// renamed regression (e.g. `dismissedFlag`) would still fail.
	const src = await readHookSource();
	const match = src.match(/export function useFileEditorLsp\(([\s\S]*?)\)\s*:/);
	expect(match).not.toBeNull();
	const params = (match?.[1] ?? "")
		.split(",")
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.map((p) => {
			// Strip type annotations: keep only the identifier before `:` or `=`.
			const name = p.split(/[:=]/)[0]?.trim() ?? "";
			return name;
		});
	expect(params).toEqual(["model", "repoPath", "language", "filePath"]);
});
