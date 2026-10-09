import { expect, mock, test } from "bun:test";
import { act } from "react";
import { detectLanguage } from "../src/shared/diff-types";
import type { PRContext } from "../src/shared/github-types";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "diff preview file types in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");
	const { useReviewSessionStore } = await import("../src/renderer/stores/review-session-store");

	// Exercise the real viewers, store, preview controls and Markdown renderers.
	// Monaco itself needs browser layout; expose its inputs for these routing tests.
	mock.module("../src/renderer/components/DiffEditor", () => ({
		DiffEditor: (props: {
			original: string;
			modified: string;
			language: string;
			renderSideBySide: boolean;
		}) => (
			<div
				data-code-diff
				data-language={props.language}
				data-original={props.original}
				data-modified={props.modified}
				data-side-by-side={props.renderSideBySide}
			/>
		),
	}));
	const { DiffFileTab } = await import("../src/renderer/components/DiffFileTab");
	const { PRReviewFileTab } = await import("../src/renderer/components/PRReviewFileTab");
	const { ReviewTab } = await import("../src/renderer/components/review/ReviewTab");

	const repoPath = "/fixture/repo";
	const workspaceId = "diff-preview";
	const prCtx: PRContext = {
		provider: "github",
		owner: "fixture",
		repo: "repo",
		number: 1,
		title: "Preview fixture",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath,
	};
	const paths = [
		"README.md",
		"src/app.tsx",
		"src/Example.cs",
		"infra/terraform.tfvars",
		"config.json",
		"script.py",
		"unknown.custom",
		"guide.mdx",
	];
	const files = paths.map((path) => ({
		path,
		status: "modified" as const,
		additions: 1,
		deletions: 1,
		hunks: [],
	}));
	const surfaces = ["working-tree", "branch", "pr", "review-working", "review-branch"] as const;
	const modes = ["split", "rendered", "rich-diff"] as const;

	test("opening C# branch review with rich Markdown diff active preserves source and enables layout controls", async () => {
		const filePath = "Tests/ExampleTests.cs";
		const original = [
			"namespace Example.Tests;",
			"",
			"internal class ExampleTests",
			"{",
			'    private string Name = "before";',
			"}",
			"",
		].join("\n");
		const modified = `using System.Net;\nusing System.Web;\n\n${original}`;
		useTabStore.setState({ markdownPreviewMode: "rich-diff", diffMode: "inline" });
		useReviewSessionStore.getState().startSession({ workspaceId, scope: "branch", filePath });
		const h = await renderBrowserTest(
			<ReviewTab workspaceId={workspaceId} repoPath={repoPath} baseBranch="main" />,
			[],
			false,
			{
				request: (path, input) => {
					if (path === "diff.getFileContent") {
						return { content: (input as { ref: string }).ref === "" ? modified : original };
					}
					if (path === "diff.getWorkingTreeStatus") {
						return { branch: "feature", stagedFiles: [], unstagedFiles: [] };
					}
					if (path === "diff.getBranchDiff") {
						return {
							mergeBase: "base-sha",
							files: [
								{ path: filePath, status: "modified", additions: 3, deletions: 0, hunks: [] },
							],
						};
					}
					if (path === "inlineComments.list" || path === "review.getViewed") return [];
					throw new Error(`Unexpected request: ${path}`);
				},
			}
		);
		try {
			await h.settle();
			await h.settle();
			expect(h.container.querySelector(".markdown-body") !== null).toBe(false);
			const editor = h.container.querySelector("[data-code-diff]");
			expect(editor?.getAttribute("data-language")).toBe("csharp");
			expect(editor?.getAttribute("data-original")).toBe(original);
			expect(editor?.getAttribute("data-modified")).toBe(modified);
			expect(editor?.getAttribute("data-side-by-side")).toBe("false");
			const layoutButton = h.container.querySelector<HTMLButtonElement>(
				'button[title="Switch to split view"]'
			);
			expect(layoutButton?.disabled).toBe(false);
			await act(async () => layoutButton?.click());
			expect(h.container.querySelector("[data-code-diff]")?.getAttribute("data-side-by-side")).toBe(
				"true"
			);
		} finally {
			await h.cleanup();
			useReviewSessionStore.getState().endSession();
			useTabStore.setState({ markdownPreviewMode: "off", diffMode: "split" });
		}
	});

	for (const surface of surfaces) {
		for (const mode of modes) {
			test(`${surface}: ${mode} preview stays on Markdown when switching files`, async () => {
				useTabStore.setState({ markdownPreviewMode: "off", diffMode: "split" });
				useReviewSessionStore.getState().startSession({
					workspaceId,
					scope: surface === "review-branch" ? "branch" : "working",
					filePath: "README.md",
				});
				const view = (filePath: string) => {
					const language = detectLanguage(filePath);
					if (surface === "pr") {
						return <PRReviewFileTab prCtx={prCtx} filePath={filePath} language={language} />;
					}
					if (surface === "review-working" || surface === "review-branch") {
						return <ReviewTab workspaceId={workspaceId} repoPath={repoPath} baseBranch="main" />;
					}
					const diffCtx =
						surface === "branch"
							? { type: surface, repoPath, baseBranch: "main", headBranch: "feature" }
							: { type: surface, repoPath };
					return <DiffFileTab diffCtx={diffCtx} filePath={filePath} language={language} />;
				};
				const h = await renderBrowserTest(view("README.md"), [], false, {
					request: (path, input) => {
						if (path === "diff.getFileContent") {
							const { ref } = input as { ref: string };
							return { content: ref === "" || ref === "feature" ? "# After\n" : "# Before\n" };
						}
						if (path === "diff.getWorkingTreeStatus") {
							return { branch: "feature", stagedFiles: [], unstagedFiles: files };
						}
						if (path === "diff.getBranchDiff") return { mergeBase: "base-sha", files };
						if (path === "github.getPRDetails") return { files, reviewThreads: [] };
						if (
							[
								"inlineComments.list",
								"review.getViewed",
								"github.getViewedFiles",
								"aiReview.getReviewDrafts",
							].includes(path)
						)
							return [];
						throw new Error(`Unexpected request: ${path}`);
					},
				});
				try {
					await h.settle();
					await act(async () => useReviewSessionStore.getState().selectFile("README.md"));
					await h.settle();
					const label = mode === "split" ? "Split" : mode === "rendered" ? "Rendered" : "Diff";
					// ReviewTab also labels its diff-layout control "Split"; the preview is first there.
					const buttons = [...h.container.querySelectorAll<HTMLButtonElement>("button")].filter(
						(button) => button.textContent === label
					);
					expect(buttons.length).toBeGreaterThan(0);
					await act(async () => buttons[0]?.click());
					expect(useTabStore.getState().markdownPreviewMode).toBe(mode);
					expect(h.container.querySelector(".markdown-body h1")?.textContent).toBe(
						mode === "rich-diff" ? "Before" : "After"
					);

					for (const filePath of paths.slice(1)) {
						await act(async () => useReviewSessionStore.getState().selectFile(filePath));
						await h.rerender(view(filePath));
						await h.settle();
						if (filePath.endsWith(".mdx")) {
							expect(h.container.querySelector(".markdown-body") !== null).toBe(true);
							expect(h.container.querySelector("[data-code-diff]") !== null).toBe(mode === "split");
							continue;
						}
						expect(h.container.querySelector(".markdown-body") !== null).toBe(false);
						const editor = h.container.querySelector("[data-code-diff]");
						expect(editor?.getAttribute("data-language")).toBe(detectLanguage(filePath));
						expect(editor?.getAttribute("data-original")).toBe("# Before\n");
						expect(editor?.getAttribute("data-modified")).toBe("# After\n");
						const layoutButton = [
							...h.container.querySelectorAll<HTMLButtonElement>("button"),
						].find((button) => ["Inline", "Split", "Unified"].includes(button.textContent ?? ""));
						expect(layoutButton).toBeDefined();
						expect(layoutButton?.disabled).toBe(false);
						await act(async () => layoutButton?.click());
						expect(
							h.container.querySelector("[data-code-diff]")?.getAttribute("data-side-by-side")
						).toBe(String(useTabStore.getState().diffMode === "split"));
						expect(useTabStore.getState().markdownPreviewMode).toBe(mode);
					}
				} finally {
					await h.cleanup();
					useReviewSessionStore.getState().endSession();
					useTabStore.setState({ markdownPreviewMode: "off", diffMode: "split" });
				}
			});
		}
	}
}
