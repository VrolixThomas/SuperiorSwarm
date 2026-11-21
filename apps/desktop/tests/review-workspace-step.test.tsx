import { expect, mock, test } from "bun:test";
import { act, useEffect } from "react";
import type { GitHubPRDetails, PRContext, UnifiedThread } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";
if (inIsolatedFileBrowserTest(import.meta.path, "review steps in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	mock.module("../src/renderer/components/DiffEditor", () => ({
		DiffEditor: (p: { original: string; modified: string }) => (
			<div data-diff data-original={p.original} data-modified={p.modified} />
		),
	}));
	mock.module("../src/renderer/components/review-mode/step/ContextEditor", () => ({
		ContextEditor: (p: { content: string; onEditorReady?: (editor: object | null) => void }) => {
			useEffect(() => {
				p.onEditorReady?.({ content: p.content });
				return () => p.onEditorReady?.(null);
			}, [p.content, p.onEditorReady]);
			return <div data-context>{p.content}</div>;
		},
	}));
	for (const name of [
		"useThreadDecorations",
		"useInlineCommentZones",
		"useGutterPlusButton",
		"useFocusDecorations",
		"useContextDefinition",
		"useSelectionActions",
	]) {
		mock.module(`../src/renderer/components/review-mode/hooks/${name}`, () => ({
			[name]: () => {},
		}));
	}
	const { StepHeader } = await import("../src/renderer/components/review-mode/step/StepHeader");
	const { StepDiff } = await import("../src/renderer/components/review-mode/step/StepDiff");
	const { ContextFileView } = await import(
		"../src/renderer/components/review-mode/step/ContextFileView"
	);
	const prCtx: PRContext = {
		provider: "github",
		owner: "org",
		repo: "repo",
		number: 1,
		title: "PR",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/repo",
	};
	const details = {
		files: ["a.ts", "b.ts"].map((path) => ({
			path,
			changeType: "MODIFIED",
			additions: 1,
			deletions: 1,
		})),
		headCommitOid: "head",
	} as unknown as GitHubPRDetails;
	const callbacks = {} as import(
		"../src/renderer/components/review-mode/thread/ThreadCard"
	).ThreadCallbacks;
	test("header navigation, viewed and expanded detail are explicit actions", async () => {
		const actions: string[] = [];
		const h = await renderBrowserTest(
			<StepHeader
				filePath="src/a.ts"
				label="Step 1 of 2"
				note="Read this"
				detail="Extra explanation"
				onNext={() => actions.push("next")}
				onViewedChange={(v) => actions.push(String(v))}
				viewed={false}
				tests={[{ path: "tests/a.test.ts", changed: true }]}
				onOpenFile={(p) => actions.push(p)}
			/>
		);
		try {
			expect(h.container.textContent).not.toContain("Extra explanation");
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>("button[aria-expanded]")?.click()
			);
			expect(h.container.textContent).toContain("Extra explanation");
			await act(async () =>
				h.container.querySelector<HTMLButtonElement>('button[aria-label="Next file"]')?.click()
			);
			await act(async () =>
				h.container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click()
			);
			expect(actions).toEqual(["next", "true"]);
			expect(
				h.container.querySelector<HTMLButtonElement>('button[aria-label="Previous file"]')?.disabled
			).toBe(true);
		} finally {
			await h.cleanup();
		}
	});
	test("file switch clears old content while either next side is loading", async () => {
		let finish: ((value: { content: string }) => void) | undefined;
		const view = (filePath: string) => (
			<StepDiff
				workspaceId="w"
				prCtx={prCtx}
				details={details}
				sessionKey="step-test"
				fileOrder={["a.ts", "b.ts"]}
				filePath={filePath}
				threads={[]}
				callbacks={callbacks}
				header={null}
			/>
		);
		const h = await renderBrowserTest(view("a.ts"), [], false, {
			request: (path, input) => {
				if (path === "diff.getBranchDiff") return { mergeBase: "base", files: [] };
				if (path === "github.getViewedFiles") return [];
				if (path === "diff.getFileContent") {
					const q = input as { filePath: string; ref: string };
					if (q.filePath === "b.ts" && q.ref === "feature")
						return new Promise((resolve) => {
							finish = resolve;
						});
					return { content: `${q.filePath} ${q.ref}` };
				}
				throw Error(path);
			},
		});
		try {
			await h.settle();
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe(
				"a.ts feature"
			);
			await h.rerender(view("b.ts"));
			expect(h.container.textContent).toContain("Loading");
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe("");
			await act(async () => finish?.({ content: "b.ts feature" }));
			await h.settle();
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe(
				"b.ts feature"
			);
		} finally {
			await h.cleanup();
		}
	});
	test("context is read-only, handles empty content, never marks viewed", async () => {
		const step = {
			id: "context",
			kind: "context" as const,
			path: "context.ts",
			note: "Context note",
			focus: [],
			addedBy: "agent" as const,
		};
		const h = await renderBrowserTest(
			<ContextFileView prCtx={prCtx} step={step} headRef="head" />,
			[],
			false,
			{
				request: (path) => {
					if (path === "diff.getFileContent") return { content: "" };
					throw Error(path);
				},
			}
		);
		try {
			await h.settle();
			expect(h.container.textContent).toContain("empty or unavailable");
			expect(h.container.querySelector('input[type="checkbox"]')).toBeNull();
			expect(h.calls.every((c) => c.path === "diff.getFileContent")).toBe(true);
			expect(h.calls[0]?.input).toMatchObject({ ref: "head" });
		} finally {
			await h.cleanup();
		}
	});
	test("outdated anchors stay outside inline partitions", async () => {
		const { stepThreadLayout } = await import(
			"../src/renderer/components/review-mode/step/step-diff-model"
		);
		const current = {
			id: "current",
			path: "a.ts",
			line: 2,
			diffSide: "RIGHT",
			isResolved: false,
			comments: [],
		} as UnifiedThread;
		const outdated = { ...current, id: "old", isOutdated: true } as UnifiedThread;
		const layout = stepThreadLayout([current, outdated], "split", true, { LEFT: 3, RIGHT: 3 });
		expect(layout.rightInline.map((t) => t.id)).toEqual(["current"]);
		expect(layout.outdated.map((t) => t.id)).toEqual(["old"]);
	});
	test("replacement header keeps Markdown source visible regardless of a global preview preference", async () => {
		const { useTabStore } = await import("../src/renderer/stores/tab-store");
		useTabStore.setState({ markdownPreviewMode: "rich-diff" });
		const h = await renderBrowserTest(
			<StepDiff
				workspaceId="w"
				prCtx={prCtx}
				details={details}
				sessionKey="markdown"
				fileOrder={["README.md"]}
				filePath="README.md"
				threads={[]}
				callbacks={{}}
				header={<span>Step header</span>}
			/>,
			[],
			false,
			{
				request: (path) =>
					path === "diff.getBranchDiff"
						? { mergeBase: "base", files: [] }
						: path === "diff.getFileContent"
							? { content: "# Source" }
							: [],
			}
		);
		try {
			await h.settle();
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe(
				"# Source"
			);
			expect(h.container.querySelector(".invisible")).toBeNull();
		} finally {
			useTabStore.setState({ markdownPreviewMode: "off" });
			await h.cleanup();
		}
	});
	test("custom thread cards still select the active thread and expose scroll target", async () => {
		const { useStepThreadRenderer } = await import(
			"../src/renderer/components/review-mode/step/useStepThreadRenderer"
		);
		const { usePRReviewSessionStore } = await import(
			"../src/renderer/stores/pr-review-session-store"
		);
		const thread: UnifiedThread = {
			id: "custom",
			path: "a.ts",
			line: 1,
			diffSide: "RIGHT",
			isResolved: false,
			comments: [],
		};
		function Subject() {
			const { renderThread } = useStepThreadRenderer("custom-session", null, {}, () => (
				<button type="button">Card</button>
			));
			return renderThread(thread);
		}
		const h = await renderBrowserTest(<Subject />);
		try {
			const target = h.container.querySelector('[data-review-thread-id="custom"]');
			expect(target).not.toBeNull();
			await act(async () =>
				target?.dispatchEvent(new window.Event("pointerdown", { bubbles: true }))
			);
			expect(
				usePRReviewSessionStore.getState().sessions.get("custom-session")?.activeThreadId
			).toBe("custom");
		} finally {
			await h.cleanup();
		}
	});
	test("context readiness is withheld until asynchronous content arrives", async () => {
		let finish: ((value: { content: string }) => void) | undefined;
		let ready = 0;
		const h = await renderBrowserTest(
			<ContextFileView
				prCtx={prCtx}
				step={{
					id: "async-context",
					kind: "context",
					path: "async.ts",
					note: "",
					focus: [],
					addedBy: "user",
				}}
				onEditorReady={(editor) => {
					if (editor) ready++;
				}}
			/>,
			[],
			false,
			{
				request: () =>
					new Promise((resolve) => {
						finish = resolve;
					}),
			}
		);
		try {
			expect(ready).toBe(0);
			await act(async () => finish?.({ content: "export const ready = true;" }));
			await h.settle();
			expect(ready).toBe(1);
		} finally {
			await h.cleanup();
		}
	});
}
