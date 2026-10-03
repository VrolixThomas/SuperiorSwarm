import { expect, mock, spyOn, test } from "bun:test";
import { act, createElement } from "react";
import { inIsolatedFileBrowserTest } from "./helpers/isolated-file-browser-test";

if (inIsolatedFileBrowserTest(import.meta.path, "file editor privacy and paths in isolation")) {
	const { renderBrowserTest } = await import("./helpers/file-browser-renderer");
	const { useReviewSessionStore } = await import("../src/renderer/stores/review-session-store");
	const { useTabStore } = await import("../src/renderer/stores/tab-store");

	let changeContent = () => {};
	let modelLanguage = "";
	let modelValue = "";
	let modelUri = "";
	let editorCreations = 0;
	let scrollSubscriptions = 0;
	const disposable = { dispose() {} };
	const model = {
		get uri() {
			return { toString: () => modelUri };
		},
		getValue: () => modelValue,
		getLanguageId: () => modelLanguage,
		onDidChangeContent: (listener: () => void) => {
			changeContent = listener;
			return disposable;
		},
		dispose() {},
	};
	mock.module("monaco-editor", () => ({
		Uri: { file: (path: string) => `file://${path}`, parse: (uri: string) => uri },
		KeyCode: { Escape: 9 },
		languages: {
			registerCompletionItemProvider: () => disposable,
			registerHoverProvider: () => disposable,
			registerDefinitionProvider: () => disposable,
			registerReferenceProvider: () => disposable,
		},
		editor: {
			getModel: () => model,
			createModel: (value: string, language: string, uri: string) => {
				modelValue = value;
				modelLanguage = language;
				modelUri = uri;
				return model;
			},
			create: () => {
				editorCreations++;
				return {
					setModel() {},
					getModel: () => model,
					onKeyDown: () => disposable,
					onDidScrollChange: () => {
						scrollSubscriptions++;
						return disposable;
					},
					dispose() {},
				};
			},
		},
	}));
	mock.module("../src/renderer/lib/monacoTheme", () => ({ ensureThemeRegistered: () => "test" }));
	mock.module("monaco-vim", () => ({ initVimMode: () => disposable }));
	const { FileEditor } = await import("../src/renderer/components/FileEditor");
	const { sendDidOpen, sendDidChange, setupServerRestartListener } = await import(
		"../src/renderer/lsp/monaco-lsp-bridge"
	);
	const { setModelRepoPath, getModelRepoPath, findRepoPathFromUri } = await import(
		"../src/renderer/lsp/model-repo-map"
	);

	test("explicit env editing saves to its workspace without preview, LSP or review-overlay content", async () => {
		const notifications: unknown[] = [];
		const support = mock(async () => ({ supported: true }));
		useReviewSessionStore.getState().startSession({ workspaceId: "other" });
		const push = spyOn(useReviewSessionStore.getState(), "pushOptimisticContent");
		useTabStore.setState({ markdownPreviewMode: "rendered" });
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "fixture",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env.md",
				language: "markdown",
			}),
			[],
			false,
			{
				request: (path) =>
					path === "diff.getFileContent"
						? { content: "SYNTHETIC_ONLY=initial", language: "markdown" }
						: path === "lsp.getDismissedLanguages"
							? []
							: { ok: true },
				electron: {
					lsp: {
						getSupport: support,
						sendNotification: (value: unknown) => notifications.push(value),
					},
				},
			}
		);
		try {
			await h.settle();
			expect(modelValue).toBe("SYNTHETIC_ONLY=initial");
			modelValue = "SYNTHETIC_ONLY=edited";
			await act(async () => {
				changeContent();
				await new Promise((resolve) => setTimeout(resolve, 550));
			});
			expect(h.calls.find((call) => call.path === "diff.saveFileContent")?.input).toEqual({
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env.md",
				content: "SYNTHETIC_ONLY=edited",
			});
			expect({
				previewHasContent: h.container.textContent?.includes("SYNTHETIC_ONLY"),
				modelLanguage,
				supportCalls: support.mock.calls.length,
				notificationCount: notifications.length,
				overlayCalls: push.mock.calls.length,
			}).toEqual({
				previewHasContent: false,
				modelLanguage: "plaintext",
				supportCalls: 0,
				notificationCount: 0,
				overlayCalls: 0,
			});
		} finally {
			await h.cleanup();
			push.mockRestore();
			useReviewSessionStore.getState().endSession();
			useTabStore.setState({ markdownPreviewMode: "off" });
		}
	});

	test("bridge rejects env document sync, URI routing and restart even with custom language support", () => {
		const notifications: unknown[] = [];
		let restart: (config: string, root: string, uris: string[]) => void = () => {};
		Object.assign(window.electron, {
			lsp: {
				sendNotification: (value: unknown) => notifications.push(value),
				onServerRestarted: (listener: typeof restart) => {
					restart = listener;
					return () => {};
				},
			},
		});
		for (const uri of [
			"file:///fixture/.env",
			"file:///fixture/nested/.ENV.json",
			"file:///fixture/%2Eenv.local",
			"file:///fixture/.env.example",
		]) {
			sendDidOpen("/fixture", "json", uri, "SYNTHETIC_ONLY=sync");
			sendDidChange("/fixture", "json", uri, "SYNTHETIC_ONLY=sync", 2);
			setModelRepoPath(uri, "/fixture");
			expect(getModelRepoPath(uri)).toBeNull();
			setModelRepoPath("file:///fixture/normal.ts", "/fixture");
			expect(findRepoPathFromUri(uri)).toBeNull();
		}
		const stop = setupServerRestartListener();
		restart("custom", "/fixture", ["file:///fixture/.env.md"]);
		stop();
		expect(notifications).toEqual([]);
		sendDidOpen("/fixture", "typescript", "file:///fixture/normal.ts", "normal");
		expect(notifications).toHaveLength(1);
	});

	test("rejected workspace reads display an error without creating an empty editable model", async () => {
		modelValue = "unchanged";
		const creationsBeforeRead = editorCreations;
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "missing",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env",
				language: "plaintext",
			}),
			[],
			false,
			{
				retry: 2,
				request: (path) => {
					if (path === "diff.getFileContent") throw new Error("Rejected fixture root");
					return [];
				},
			}
		);
		try {
			await h.settle();
			expect(h.container.textContent).toContain("Unable to open file");
			expect(modelValue).toBe("unchanged");
			expect(editorCreations).toBe(creationsBeforeRead);
			expect(h.container.querySelector("button")?.textContent).toContain("Retry");
			expect(h.calls.some((call) => call.path === "diff.saveFileContent")).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
	test("linked editor keeps the originally opened target for saves and explains shared editing", async () => {
		let reads = 0;
		const target = "/fixture/main/.env";
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "linked",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env.link",
				language: "plaintext",
			}),
			[],
			false,
			{
				request: (path) => {
					if (path === "diff.getFileContent")
						return {
							content: "SYNTHETIC_ONLY=linked",
							language: "plaintext",
							symlinkTarget: ++reads === 1 ? target : "/fixture/other/.env",
						};
					return path === "lsp.getDismissedLanguages" ? [] : { ok: true };
				},
			}
		);
		try {
			await h.settle();
			expect(modelValue).toBe("SYNTHETIC_ONLY=linked");
			await act(async () => {
				await h.queryClient.invalidateQueries();
			});
			await h.settle();
			modelValue = "SYNTHETIC_ONLY=edited";
			await act(async () => {
				changeContent();
				await new Promise((resolve) => setTimeout(resolve, 550));
			});
			expect(h.calls.find((call) => call.path === "diff.saveFileContent")?.input).toMatchObject({
				expectedSymlinkTarget: target,
				content: "SYNTHETIC_ONLY=edited",
			});
			expect(h.container.textContent).toContain("Saves update the linked file");
		} finally {
			await h.cleanup();
		}
	});

	test("a non-env alias cannot send linked env content into LSP, previews or review overlays", async () => {
		const support = mock(async () => ({ supported: true }));
		const notifications: unknown[] = [];
		useReviewSessionStore.getState().startSession({ workspaceId: "b" });
		const push = spyOn(useReviewSessionStore.getState(), "pushOptimisticContent");
		useTabStore.setState({ markdownPreviewMode: "rendered" });
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "alias",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: "config.md",
				language: "markdown",
			}),
			[],
			false,
			{
				request: (path) =>
					path === "diff.getFileContent"
						? {
								content: "SYNTHETIC_ONLY=alias",
								language: "markdown",
								symlinkTarget: "/fixture/main/.env",
							}
						: path === "lsp.getDismissedLanguages"
							? []
							: { ok: true },
				electron: {
					lsp: {
						getSupport: support,
						sendNotification: (value: unknown) => notifications.push(value),
					},
				},
			}
		);
		try {
			await h.settle();
			await act(async () => {
				changeContent();
				await new Promise((resolve) => setTimeout(resolve, 550));
			});
			expect({
				language: modelLanguage,
				preview: h.container.textContent?.includes("SYNTHETIC_ONLY"),
				supportCalls: support.mock.calls.length,
				notifications,
				overlayCalls: push.mock.calls.length,
			}).toEqual({
				language: "plaintext",
				preview: false,
				supportCalls: 0,
				notifications: [],
				overlayCalls: 0,
			});
		} finally {
			await h.cleanup();
			push.mockRestore();
			useReviewSessionStore.getState().endSession();
			useTabStore.setState({ markdownPreviewMode: "off" });
		}
	});

	test("a rejected linked save stays visible to the user and preserves the editor buffer", async () => {
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "changed-link",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env.link",
				language: "plaintext",
			}),
			[],
			false,
			{
				request: (path) => {
					if (path === "diff.getFileContent")
						return {
							content: "SYNTHETIC_ONLY=initial",
							language: "plaintext",
							symlinkTarget: "/fixture/main/.env",
						};
					if (path === "diff.saveFileContent") throw new Error("File link target changed");
					return [];
				},
			}
		);
		try {
			await h.settle();
			modelValue = "SYNTHETIC_ONLY=unsaved";
			await act(async () => {
				changeContent();
				await new Promise((resolve) => setTimeout(resolve, 550));
			});
			await h.settle();
			expect(h.container.textContent).toContain("Unable to save file");
			expect(modelValue).toBe("SYNTHETIC_ONLY=unsaved");
		} finally {
			await h.cleanup();
		}
	});
	test("Retry loads a repaired link into a newly created editor", async () => {
		let reads = 0;
		const creationsBeforeRead = editorCreations;
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "retry-link",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env.link",
				language: "plaintext",
			}),
			[],
			false,
			{
				request: (path) => {
					if (path !== "diff.getFileContent") return [];
					if (++reads === 1) throw new Error("Broken fixture link");
					return {
						content: "SYNTHETIC_ONLY=repaired",
						language: "plaintext",
						symlinkTarget: "/fixture/main/.env",
					};
				},
			}
		);
		try {
			expect(editorCreations).toBe(creationsBeforeRead);
			await act(async () => h.container.querySelector<HTMLButtonElement>("button")?.click());
			await h.settle();
			expect(reads).toBe(2);
			expect(editorCreations).toBe(creationsBeforeRead + 1);
			expect(modelValue).toBe("SYNTHETIC_ONLY=repaired");
			expect(h.container.textContent).not.toContain("Unable to open file");
		} finally {
			await h.cleanup();
		}
	});
	test("explicit reopen reads the current linked target before creating the model, even with fresh cached content", async () => {
		const { getQueryKey } = await import("@trpc/react-query");
		const { trpc } = await import("../src/renderer/trpc/client");
		const input = { workspaceId: "b", repoPath: "/fixture/b", filePath: ".env.link", ref: "" };
		const target = "/fixture/changed/.env";
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "reopened",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: ".env.link",
				language: "plaintext",
			}),
			[],
			false,
			{
				seedQueries: (client) =>
					client.setQueryData(getQueryKey(trpc.diff.getFileContent, input, "query"), {
						content: "SYNTHETIC_ONLY=stale",
						language: "plaintext",
						symlinkTarget: "/fixture/previous/.env",
					}),
				request: async (path) => {
					if (path !== "diff.getFileContent") return [];
					await new Promise((resolve) => setTimeout(resolve, 25));
					return { content: "SYNTHETIC_ONLY=fresh", language: "plaintext", symlinkTarget: target };
				},
			}
		);
		try {
			await h.settle();
			await h.settle();
			expect(h.calls.filter((call) => call.path === "diff.getFileContent")).toHaveLength(1);
			expect(modelValue).toBe("SYNTHETIC_ONLY=fresh");
			await act(async () => {
				changeContent();
				await new Promise((resolve) => setTimeout(resolve, 550));
			});
			expect(h.calls.find((call) => call.path === "diff.saveFileContent")?.input).toMatchObject({
				expectedSymlinkTarget: target,
			});
		} finally {
			await h.cleanup();
		}
	});
	test("ordinary Markdown split scrolling initializes after the delayed file read", async () => {
		const before = scrollSubscriptions;
		useTabStore.setState({ markdownPreviewMode: "split" });
		const h = await renderBrowserTest(
			createElement(FileEditor, {
				tabId: "markdown",
				workspaceId: "b",
				repoPath: "/fixture/b",
				filePath: "README.md",
				language: "markdown",
			}),
			[],
			false,
			{
				request: (path) =>
					path === "diff.getFileContent"
						? { content: "# Synthetic fixture", language: "markdown" }
						: [],
			}
		);
		try {
			await h.settle();
			expect(scrollSubscriptions).toBe(before + 1);
		} finally {
			await h.cleanup();
			useTabStore.setState({ markdownPreviewMode: "off" });
		}
	});
}
