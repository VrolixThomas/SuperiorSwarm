import { beforeEach, expect, mock, test } from "bun:test";
import type { QueueViewItem } from "../src/shared/activity-queue";
let prepared: { projectId: string; url?: string };
const opens: unknown[] = [];
mock.module("../src/renderer/trpc/client", () => ({
	trpcVanilla: {
		queueHooks: {
			open: {
				mutate: async (input: unknown) => {
					opens.push(input);
					return prepared;
				},
			},
		},
	},
}));
mock.module("../src/renderer/lib/activity-queue-navigation", () => ({
	openQueueTarget: async () => null,
}));
const { openQueueItem } = await import("../src/renderer/lib/queue-item-open");
const { useProjectStore } = await import("../src/renderer/stores/projects");
const { useTabStore } = await import("../src/renderer/stores/tab-store");
const item = {
	id: "hook:a:check:key",
	revision: 1,
	category: "hooks",
	target: { type: "project-hook", projectId: "project-a", hookId: "check", key: "key" },
} as QueueViewItem;
beforeEach(() => {
	prepared = { projectId: "project-a" };
	opens.length = 0;
	useProjectStore.setState({ selectedProjectId: "project-b" });
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		sidebarSegment: "queue",
		activeWorkspaceBySegment: {
			...useTabStore.getState().activeWorkspaceBySegment,
			repos: { id: "workspace-b", cwd: "/project-b" },
		},
		rightPanel: {
			open: true,
			mode: "diff",
			diffCtx: { type: "working-tree", repoPath: "/project-b" },
		},
	});
});
test("Open project hook does not restore another project's saved workspace or right panel", async () => {
	await openQueueItem(item);
	expect(opens).toEqual([{ id: item.id, revision: item.revision }]);
	expect(useProjectStore.getState().selectedProjectId).toBe("project-a");
	expect(useTabStore.getState()).toMatchObject({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		sidebarSegment: "repos",
		rightPanel: { open: false },
	});
	expect(useTabStore.getState().activeWorkspaceBySegment.repos).toEqual({
		id: "workspace-b",
		cwd: "/project-b",
	});
});
test("explicit ordinary segment navigation still restores its saved workspace", () => {
	useTabStore.getState().setSidebarSegment("repos");
	expect(useTabStore.getState()).toMatchObject({
		activeWorkspaceId: "workspace-b",
		activeWorkspaceCwd: "/project-b",
	});
});
test("hook URL Open leaves selected workspace unchanged and does not acknowledge", async () => {
	prepared = { projectId: "project-a", url: "https://example.test/check" };
	const urls: string[] = [];
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { electron: { shell: { openExternal: async (url: string) => urls.push(url) } } },
	});
	await openQueueItem(item);
	expect(urls).toEqual([prepared.url!]);
	expect(useTabStore.getState().sidebarSegment).toBe("queue");
	expect(useProjectStore.getState().selectedProjectId).toBe("project-b");
	expect(opens).toHaveLength(1);
});
