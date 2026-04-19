import type { ScopedDiffFile } from "../../shared/review-types";
import { useActionStore } from "../stores/action-store";
import { usePaneStore } from "../stores/pane-store";
import { useReviewSessionStore } from "../stores/review-session-store";
import { useTabStore } from "../stores/tab-store";

function activeReviewTabFocused(): boolean {
	const ts = useTabStore.getState();
	const ps = usePaneStore.getState();
	const wsId = ts.activeWorkspaceId;
	if (!wsId) return false;
	const focused = ps.getFocusedPane(wsId);
	if (!focused) return false;
	const active = focused.tabs.find((t) => t.id === focused.activeTabId);
	return active?.kind === "review";
}

function scopedFilesFromStore(): ScopedDiffFile[] {
	return useReviewSessionStore.getState().lastScopedFiles;
}

export function registerReviewActions(): void {
	const store = useActionStore.getState();

	store.registerMany([
		{
			id: "review.openTab",
			label: "Open Review Tab",
			category: "Navigation",
			shortcut: { key: "r", meta: true, shift: true },
			execute: () => {
				const ts = useTabStore.getState();
				const wsId = ts.activeWorkspaceId;
				const repoPath = ts.activeWorkspaceCwd;
				if (!wsId || !repoPath) return;
				const baseBranch = ts.baseBranchByWorkspace[wsId] ?? "main";
				ts.openReviewTab({ workspaceId: wsId, repoPath, baseBranch });
			},
			keywords: ["changes", "diff", "walk"],
		},
		{
			id: "review.nextFile",
			label: "Next File (Review)",
			category: "Navigation",
			shortcut: { key: "j" },
			when: activeReviewTabFocused,
			execute: () => useReviewSessionStore.getState().nextFile(scopedFilesFromStore()),
		},
		{
			id: "review.prevFile",
			label: "Previous File (Review)",
			category: "Navigation",
			shortcut: { key: "k" },
			when: activeReviewTabFocused,
			execute: () => useReviewSessionStore.getState().prevFile(scopedFilesFromStore()),
		},
		{
			id: "review.scopeAll",
			label: "Review Scope: All",
			category: "View",
			shortcut: { key: "1" },
			when: activeReviewTabFocused,
			execute: () => useReviewSessionStore.getState().setScope("all", scopedFilesFromStore()),
		},
		{
			id: "review.scopeWorking",
			label: "Review Scope: Working",
			category: "View",
			shortcut: { key: "2" },
			when: activeReviewTabFocused,
			execute: () => {
				const all = useReviewSessionStore.getState().lastAllFiles;
				useReviewSessionStore
					.getState()
					.setScope("working", all.filter((f) => f.scope === "working"));
			},
		},
		{
			id: "review.scopeBranch",
			label: "Review Scope: Branch",
			category: "View",
			shortcut: { key: "3" },
			when: activeReviewTabFocused,
			execute: () => {
				const all = useReviewSessionStore.getState().lastAllFiles;
				useReviewSessionStore
					.getState()
					.setScope("branch", all.filter((f) => f.scope === "branch"));
			},
		},
		{
			id: "review.toggleViewed",
			label: "Toggle Viewed (Review)",
			category: "View",
			shortcut: { key: "v" },
			when: activeReviewTabFocused,
			execute: () => {
				window.dispatchEvent(new CustomEvent("review:toggle-viewed"));
			},
		},
		{
			id: "review.openEdit",
			label: "Open Current File for Editing (Review)",
			category: "Navigation",
			shortcut: { key: "e" },
			when: activeReviewTabFocused,
			execute: () => {
				window.dispatchEvent(new CustomEvent("review:open-edit"));
			},
		},
		{
			id: "review.closeEdit",
			label: "Close Edit Split (Review)",
			category: "Navigation",
			shortcut: { key: "Escape" },
			when: () =>
				useReviewSessionStore.getState().activeSession?.editSplitPaneId != null,
			execute: () => {
				window.dispatchEvent(new CustomEvent("review:close-edit"));
			},
		},
	]);
}
