import { expect, mock, test } from "bun:test";
import type * as monaco from "monaco-editor";
import { act } from "react";
import type { UnifiedThread } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (inIsolatedFileBrowserTest(import.meta.path, "review model zones in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("monaco-editor", () => ({ editor: { EditorOption: { lineHeight: 1 } } }));
	const { useInlineCommentZones } = await import(
		"../src/renderer/components/review-mode/hooks/useInlineCommentZones"
	);
	Object.assign(globalThis, {
		ResizeObserver: class {
			observe() {}
			disconnect() {}
		},
	});
	test("same-line zones reattach on each model swap without leaking roots", async () => {
		const zones = new Map<string, HTMLElement>();
		const listeners = new Set<() => void>();
		let nextId = 0;
		let model = {};
		const codeEditor = {
			getModel: () => model,
			getOption: () => 20,
			onDidChangeModel: (fn: () => void) => {
				listeners.add(fn);
				return { dispose: () => listeners.delete(fn) };
			},
			changeViewZones: (
				fn: (a: {
					addZone: (zone: { domNode: HTMLElement }) => string;
					removeZone: (id: string) => void;
				}) => void
			) =>
				fn({
					addZone: ({ domNode }) => {
						const id = String(++nextId);
						zones.set(id, domNode);
						return id;
					},
					removeZone: (id) => {
						zones.delete(id);
					},
				}),
		};
		const editor = {
			getModifiedEditor: () => codeEditor,
			getOriginalEditor: () => codeEditor,
		} as unknown as monaco.editor.IStandaloneDiffEditor;
		const threads = [
			{ id: "thread", path: "a.ts", line: 2, diffSide: "RIGHT", isResolved: false, comments: [] },
		] as UnifiedThread[];
		const renderThread = (thread: UnifiedThread) => <span>{thread.id}</span>;
		const noop = () => {};
		function Surface({ filePath }: { filePath: string }) {
			useInlineCommentZones(editor, "RIGHT", threads, null, renderThread, noop, noop, "", filePath);
			return <div />;
		}
		const h = await renderBrowserTest(<Surface filePath="a.ts" />);
		try {
			expect(zones.size).toBe(1);
			for (const filePath of ["b.ts", "a.ts", "b.ts"]) {
				await act(async () => {
					zones.clear();
					model = {};
					for (const listener of listeners) listener();
				});
				await h.rerender(<Surface filePath={filePath} />);
				expect(zones.size).toBe(1);
				expect([...zones.values()][0]?.textContent).toBe("thread");
			}
			// An in-place content refresh also swaps the model but keeps the file key.
			await act(async () => {
				zones.clear();
				model = {};
				for (const listener of listeners) listener();
			});
			expect(zones.size).toBe(1);
		} finally {
			await h.cleanup();
		}
		expect(zones.size).toBe(0);
		expect(listeners.size).toBe(0);
	});
	test("outdated threads cannot create a line zone", async () => {
		const add = mock(() => "zone");
		const codeEditor = {
			getModel: () => null,
			onDidChangeModel: () => ({ dispose() {} }),
			getOption: () => 20,
			changeViewZones: (fn: (a: unknown) => void) => fn({ addZone: add, removeZone() {} }),
		};
		const editor = {
			getModifiedEditor: () => codeEditor,
		} as unknown as monaco.editor.IStandaloneDiffEditor;
		const threads = [
			{ id: "old", line: 2, isOutdated: true, isResolved: false, comments: [] },
		] as unknown as UnifiedThread[];
		function Surface() {
			useInlineCommentZones(
				editor,
				"RIGHT",
				threads,
				null,
				() => null,
				() => {},
				() => {}
			);
			return <div />;
		}
		const h = await renderBrowserTest(<Surface />);
		try {
			expect(add).not.toHaveBeenCalled();
		} finally {
			await h.cleanup();
		}
	});
}
