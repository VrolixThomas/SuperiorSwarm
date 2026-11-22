import { expect, test } from "bun:test";
import type * as monaco from "monaco-editor";
import { act } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (
	inIsolatedFileBrowserTest(import.meta.path, "selection actions preserve anchors in isolation")
) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useSelectionActions } = await import(
		"../src/renderer/components/review-mode/hooks/useSelectionActions"
	);
	let notify = () => {};
	let selection = { startLineNumber: 12, endLineNumber: 14, isEmpty: () => false };
	const zones = new Map<string, HTMLElement>();
	let id = 0;
	const fakeEditor = {
		getModifiedEditor: () => ({
			getSelection: () => selection,
			changeViewZones: (change: (accessor: unknown) => void) =>
				change({
					addZone: ({ domNode }: { domNode: HTMLElement }) => {
						const key = String(++id);
						zones.set(key, domNode);
						return key;
					},
					removeZone: (key: string) => zones.delete(key),
				}),
			onDidChangeCursorSelection: (callback: () => void) => {
				notify = callback;
				return { dispose() {} };
			},
			onDidChangeModel: () => ({ dispose() {} }),
		}),
	} as unknown as monaco.editor.IStandaloneDiffEditor;
	const anchors: string[] = [];
	function Subject({
		file,
		readOnly = false,
		commentLines,
	}: { file: string; readOnly?: boolean; commentLines?: ReadonlySet<number> }) {
		useSelectionActions(fakeEditor, {
			filePath: file,
			commentLines,
			onAsk: (anchor) => anchors.push(`ask:${anchor.path}:${anchor.startLine}-${anchor.endLine}`),
			onComment: readOnly
				? undefined
				: (anchor) => anchors.push(`comment:${anchor.path}:${anchor.endLine}`),
		});
		return null;
	}
	test("selection buttons use current file, disappear on clear, and prohibit read-only comments", async () => {
		const h = await renderBrowserTest(<Subject file="first.ts" />);
		try {
			await act(async () => notify());
			const zone = [...zones.values()][0];
			expect(zone?.textContent).toContain("Ask agent");
			zone?.querySelector("button")?.click();
			expect(anchors).toContain("ask:first.ts:12-14");
			await h.rerender(<Subject file="first.ts" commentLines={new Set([20])} />);
			await act(async () => notify());
			expect([...zones.values()][0]?.textContent).not.toContain("Comment");
			await h.rerender(<Subject file="second.ts" readOnly />);
			expect(zones.size).toBe(0);
			await act(async () => notify());
			expect([...zones.values()][0]?.textContent).not.toContain("Comment");
			[...zones.values()][0]?.querySelector("button")?.click();
			expect(anchors).toContain("ask:second.ts:12-14");
			selection = { ...selection, isEmpty: () => true };
			await act(async () => notify());
			expect(zones.size).toBe(0);
		} finally {
			await h.cleanup();
		}
	});
}
