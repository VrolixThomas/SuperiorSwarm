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
			create: () => ({
				setModel() {},
				getModel: () => model,
				onKeyDown: () => disposable,
				onDidScrollChange: () => disposable,
				dispose() {},
			}),
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
			expect(h.calls.some((call) => call.path === "diff.saveFileContent")).toBe(false);
		} finally {
			await h.cleanup();
		}
	});
}
