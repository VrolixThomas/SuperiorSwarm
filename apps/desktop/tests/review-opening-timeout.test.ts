import { expect, test } from "bun:test";
import { openPRReview } from "../src/renderer/lib/open-pr-review";
import { useTabStore } from "../src/renderer/stores/tab-store";

const input = {
	projectId: "project",
	prCtx: {
		provider: "bitbucket" as const,
		owner: "team",
		repo: "repo",
		number: 12,
		title: "PR",
		sourceBranch: "feature",
		targetBranch: "main",
		repoPath: "/repo",
	},
};
test("a timed-out workspace request cannot navigate after its delayed result arrives", async () => {
	useTabStore.setState({ activeWorkspaceId: "current" });
	let finish!: (value: { id: string; worktreePath: string }) => void;
	const request = new Promise<{ id: string; worktreePath: string }>((resolve) => {
		finish = resolve;
	});
	await expect(openPRReview(input, () => request, { timeoutMs: 10 })).rejects.toThrow("too long");
	finish({ id: "late", worktreePath: "/late" });
	await Promise.resolve();
	expect(useTabStore.getState().activeWorkspaceId).toBe("current");
});
test("a result arriving after navigation elsewhere does not steal focus", async () => {
	useTabStore.setState({ activeWorkspaceId: "another" });
	let current = true;
	let finish: ((value: { id: string; worktreePath: string }) => void) | undefined;
	const result = openPRReview(
		input,
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
		{ isCurrent: () => current }
	);
	await Promise.resolve();
	current = false;
	finish?.({ id: "prepared", worktreePath: "/prepared" });
	await expect(result).rejects.toThrow("no longer active");
	expect(useTabStore.getState().activeWorkspaceId).toBe("another");
});
