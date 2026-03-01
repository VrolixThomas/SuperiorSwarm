import { describe, test, expect, beforeEach } from "bun:test";
import { useTabsStore } from "../src/renderer/stores/tabs";
beforeEach(() => {
    useTabsStore.setState({
        fileTabs: [],
        activePane: { kind: "terminal" },
    });
});
describe("useTabsStore", () => {
    test("openFileTab creates a new tab and switches activePane to file", () => {
        const id = useTabsStore.getState().openFileTab({
            type: "diff-file",
            filePath: "src/main.ts",
            title: "main.ts",
            language: "typescript",
            diffCtx: { type: "working-tree", repoPath: "/repo" },
        });
        const state = useTabsStore.getState();
        expect(state.fileTabs).toHaveLength(1);
        expect(state.fileTabs[0]?.filePath).toBe("src/main.ts");
        expect(state.activePane).toEqual({ kind: "file", tabId: id });
    });
    test("openFileTab is idempotent — focuses existing tab", () => {
        useTabsStore.getState().openFileTab({
            type: "diff-file",
            filePath: "src/foo.ts",
            title: "foo.ts",
            language: "typescript",
            diffCtx: { type: "working-tree", repoPath: "/repo" },
        });
        const id2 = useTabsStore.getState().openFileTab({
            type: "diff-file",
            filePath: "src/foo.ts",
            title: "foo.ts",
            language: "typescript",
            diffCtx: { type: "working-tree", repoPath: "/repo" },
        });
        expect(useTabsStore.getState().fileTabs).toHaveLength(1);
        expect(useTabsStore.getState().activePane).toEqual({ kind: "file", tabId: id2 });
    });
    test("closeFileTab removes the tab and falls back to terminal when last tab closes", () => {
        const id = useTabsStore.getState().openFileTab({
            type: "file",
            filePath: "src/bar.ts",
            title: "bar.ts",
            language: "typescript",
            repoPath: "/repo",
        });
        useTabsStore.getState().closeFileTab(id);
        const state = useTabsStore.getState();
        expect(state.fileTabs).toHaveLength(0);
        expect(state.activePane).toEqual({ kind: "terminal" });
    });
    test("closeFileTab activates adjacent tab when not last", () => {
        const id1 = useTabsStore.getState().openFileTab({
            type: "file",
            filePath: "src/a.ts",
            title: "a.ts",
            language: "typescript",
            repoPath: "/repo",
        });
        const id2 = useTabsStore.getState().openFileTab({
            type: "file",
            filePath: "src/b.ts",
            title: "b.ts",
            language: "typescript",
            repoPath: "/repo",
        });
        useTabsStore.getState().closeFileTab(id2);
        const state = useTabsStore.getState();
        expect(state.fileTabs).toHaveLength(1);
        expect(state.activePane).toEqual({ kind: "file", tabId: id1 });
    });
    test("setActivePane can switch to terminal", () => {
        const id = useTabsStore.getState().openFileTab({
            type: "file",
            filePath: "src/x.ts",
            title: "x.ts",
            language: "typescript",
            repoPath: "/repo",
        });
        expect(useTabsStore.getState().activePane).toEqual({ kind: "file", tabId: id });
        useTabsStore.getState().setActivePane({ kind: "terminal" });
        expect(useTabsStore.getState().activePane).toEqual({ kind: "terminal" });
    });
    test("closeAllDiffTabs removes all diff-file tabs for a given repoPath", () => {
        useTabsStore.getState().openFileTab({
            type: "diff-file",
            filePath: "src/a.ts",
            title: "a.ts",
            language: "typescript",
            diffCtx: { type: "working-tree", repoPath: "/repo" },
        });
        useTabsStore.getState().openFileTab({
            type: "diff-file",
            filePath: "src/b.ts",
            title: "b.ts",
            language: "typescript",
            diffCtx: { type: "working-tree", repoPath: "/repo" },
        });
        const fileId = useTabsStore.getState().openFileTab({
            type: "file",
            filePath: "src/c.ts",
            title: "c.ts",
            language: "typescript",
            repoPath: "/repo",
        });
        useTabsStore.getState().closeAllDiffTabs("/repo");
        const state = useTabsStore.getState();
        expect(state.fileTabs).toHaveLength(1);
        expect(state.fileTabs[0]?.type).toBe("file");
        expect(state.activePane).toEqual({ kind: "file", tabId: fileId });
    });
});
