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
		headCommitOid: "a".repeat(40),
		baseCommitOid: "b".repeat(40),
	} as unknown as GitHubPRDetails;
	const snapshot = {
		id: "c".repeat(64),
		files: ["a.ts", "b.ts", "README.md"].map((path) => ({ id: path, path })),
	};
	const text = (content: string) => ({
		kind: "text" as const,
		content,
		path: "fixture",
		blobOid: "d".repeat(40),
	});
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
		let finish: ((value: ReturnType<typeof text>) => void) | undefined;
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
				if (path === "reviewExplanation.resolveSnapshot") return snapshot;
				if (path === "github.getViewedFiles") return [];
				if (path === "reviewExplanation.getSnapshotFile") {
					const q = input as { fileId: string; side: string };
					if (q.fileId === "b.ts" && q.side === "head")
						return new Promise((resolve) => {
							finish = resolve;
						});
					return text(`${q.fileId} ${q.side}`);
				}
				throw Error(path);
			},
		});
		try {
			await h.settle();
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe(
				"a.ts head"
			);
			await h.rerender(view("b.ts"));
			expect(h.container.textContent).toContain("Loading");
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe("");
			await act(async () => finish?.(text("b.ts head")));
			await h.settle();
			expect(h.container.querySelector("[data-diff]")?.getAttribute("data-modified")).toBe(
				"b.ts head"
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
			<ContextFileView
				workspaceId="w"
				prCtx={prCtx}
				step={step}
				headRef={details.headCommitOid}
				baseRef={details.baseCommitOid}
			/>,
			[],
			false,
			{
				request: (path) => {
					if (path === "reviewExplanation.resolveSnapshot") return snapshot;
					if (path === "reviewExplanation.getSnapshotContext") return text("");
					throw Error(path);
				},
			}
		);
		try {
			await h.settle();
			expect(h.container.textContent).toContain("File is empty at this revision");
			expect(h.container.querySelector('input[type="checkbox"]')).toBeNull();
			expect(h.calls.every((c) => c.path.startsWith("reviewExplanation."))).toBe(true);
			expect(h.calls[0]?.input).toMatchObject({ headOid: details.headCommitOid });
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
					path === "reviewExplanation.resolveSnapshot"
						? snapshot
						: path === "reviewExplanation.getSnapshotFile"
							? text("# Source")
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
		let finish: ((value: ReturnType<typeof text>) => void) | undefined;
		let ready = 0;
		const h = await renderBrowserTest(
			<ContextFileView
				workspaceId="w"
				baseRef={details.baseCommitOid}
				headRef={details.headCommitOid}
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
				request: (path) =>
					path === "reviewExplanation.resolveSnapshot"
						? snapshot
						: new Promise((resolve) => {
								finish = resolve;
							}),
			}
		);
		try {
			expect(ready).toBe(0);
			await act(async () => finish?.(text("export const ready = true;")));
			await h.settle();
			expect(ready).toBe(1);
		} finally {
			await h.cleanup();
		}
	});
}
