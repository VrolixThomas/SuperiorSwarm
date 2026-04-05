import type { LayoutNode } from "../../shared/pane-types";
import { useActionStore } from "../stores/action-store";
import { useBranchStore } from "../stores/branch-store";
import { findParentSplit, findSplitById, getAllPanes, usePaneStore } from "../stores/pane-store";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";

// ─── Directional focus helper (moved from usePaneShortcuts.ts) ──────────────

type Direction = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

function findDirectionalNeighbor(root: LayoutNode, paneId: string, dir: Direction): string | null {
	const chain: { splitId: string; childId: string }[] = [];
	let currentId = paneId;

	for (;;) {
		const parent = findParentSplit(root, currentId);
		if (!parent) break;
		chain.push({ splitId: parent.id, childId: currentId });
		currentId = parent.id;
	}

	const isHorizontal = dir === "ArrowLeft" || dir === "ArrowRight";
	const wantsFirst = dir === "ArrowLeft" || dir === "ArrowUp";

	for (const { splitId, childId } of chain) {
		const split = findSplitById(root, splitId);
		if (!split) continue;

		const splitIsHorizontal = split.direction === "horizontal";
		if (isHorizontal !== splitIsHorizontal) continue;

		const isFirstChild = split.children[0].id === childId;

		if (wantsFirst && !isFirstChild) {
			const panes = getAllPanes(split.children[0]);
			return panes[panes.length - 1]?.id ?? null;
		}
		if (!wantsFirst && isFirstChild) {
			const panes = getAllPanes(split.children[1]);
			return panes[0]?.id ?? null;
		}
	}

	return null;
}

// ─── Pane focus helper ──────────────────────────────────────────────────────

function focusDirection(dir: Direction) {
	const wsId = useTabStore.getState().activeWorkspaceId;
	if (!wsId) return;
	const paneState = usePaneStore.getState();
	const root = paneState.getLayout(wsId);
	const focused = paneState.getFocusedPane(wsId);
	if (!root || !focused) return;
	const neighborId = findDirectionalNeighbor(root, focused.id, dir);
	if (neighborId) paneState.setFocusedPane(neighborId);
}

// ─── Tab cycling helper ─────────────────────────────────────────────────────

function cycleTab(delta: 1 | -1) {
	const wsId = useTabStore.getState().activeWorkspaceId;
	if (!wsId) return;
	const paneState = usePaneStore.getState();
	const focused = paneState.getFocusedPane(wsId);
	if (!focused || focused.tabs.length === 0) return;
	const currentIdx = focused.tabs.findIndex((t) => t.id === focused.activeTabId);
	if (currentIdx === -1) return;
	const nextIdx = (currentIdx + delta + focused.tabs.length) % focused.tabs.length;
	const nextTab = focused.tabs[nextIdx];
	if (nextTab) paneState.setActiveTabInPane(wsId, focused.id, nextTab.id);
}

// ─── Registration ───────────────────────────────────────────────────────────

export function registerCoreActions() {
	const store = useActionStore.getState();

	// ── General ─────────────────────────────────────────────────────────────

	store.register({
		id: "general.commandPalette",
		label: "Command Palette",
		category: "General",
		shortcut: { key: "k", meta: true },
		execute: () => {
			const s = useActionStore.getState();
			if (s.isPaletteOpen) s.closePalette();
			else s.openPalette();
		},
	});

	store.register({
		id: "general.settings",
		label: "Settings",
		category: "General",
		shortcut: { key: ",", meta: true },
		execute: () => useProjectStore.getState().openSettings(),
		keywords: ["preferences", "config"],
	});

	store.register({
		id: "general.addRepository",
		label: "Add Repository",
		category: "General",
		execute: () => useProjectStore.getState().openAddModal(),
		keywords: ["clone", "open", "create", "repo"],
	});

	// ── Navigation ──────────────────────────────────────────────────────────

	store.register({
		id: "nav.repos",
		label: "Repos",
		category: "Navigation",
		shortcut: { key: "1", meta: true },
		execute: () => {
			useProjectStore.getState().closeSettings();
			useTabStore.getState().setSidebarSegment("repos");
		},
		keywords: ["repositories", "projects", "workspaces"],
	});

	store.register({
		id: "nav.tickets",
		label: "Tickets",
		category: "Navigation",
		shortcut: { key: "2", meta: true },
		execute: () => {
			useProjectStore.getState().closeSettings();
			useTabStore.getState().setSidebarSegment("tickets");
		},
		keywords: ["issues", "jira", "linear"],
	});

	store.register({
		id: "nav.prs",
		label: "PRs",
		category: "Navigation",
		shortcut: { key: "3", meta: true },
		execute: () => {
			useProjectStore.getState().closeSettings();
			useTabStore.getState().setSidebarSegment("prs");
		},
		keywords: ["pull requests", "review", "github"],
	});

	// ── Branch ──────────────────────────────────────────────────────────────

	store.register({
		id: "branch.palette",
		label: "Branch Palette",
		category: "Branch",
		shortcut: { key: "b", meta: true, shift: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			const bs = useBranchStore.getState();
			if (bs.isPaletteOpen) bs.closePalette();
			else bs.openPalette();
		},
		keywords: ["switch branch", "checkout", "branches"],
	});

	// ── Git ─────────────────────────────────────────────────────────────────

	store.register({
		id: "git.commit",
		label: "Commit Staged Changes",
		category: "Git",
		shortcut: { key: "Enter", meta: true },
		when: () => useTabStore.getState().rightPanel.open === true,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:commit-shortcut"));
		},
		keywords: ["save", "commit message"],
	});

	store.register({
		id: "git.push",
		label: "Push",
		category: "Git",
		shortcut: { key: "p", meta: true, shift: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:push-shortcut"));
		},
		keywords: ["upload", "remote", "git push"],
	});

	store.register({
		id: "git.pull",
		label: "Pull",
		category: "Git",
		shortcut: { key: "u", meta: true, shift: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:pull-shortcut"));
		},
		keywords: ["download", "fetch", "update", "git pull"],
	});

	store.register({
		id: "git.stageAll",
		label: "Stage All Changes",
		category: "Git",
		shortcut: { key: "a", meta: true, shift: true },
		when: () => useTabStore.getState().rightPanel.open === true,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:stage-all-shortcut"));
		},
		keywords: ["add all", "git add"],
	});

	store.register({
		id: "git.unstageAll",
		label: "Unstage All Changes",
		category: "Git",
		when: () => useTabStore.getState().rightPanel.open === true,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:unstage-all-shortcut"));
		},
		keywords: ["reset", "git reset"],
	});

	store.register({
		id: "git.fetch",
		label: "Fetch",
		category: "Git",
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:fetch-shortcut"));
		},
		keywords: ["remote", "git fetch"],
	});

	// ── View ────────────────────────────────────────────────────────────────

	store.register({
		id: "view.toggleSidebar",
		label: "Toggle Sidebar",
		category: "View",
		shortcut: { key: "b", meta: true },
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:toggle-sidebar"));
		},
		keywords: ["sidebar", "panel", "collapse", "expand"],
	});

	store.register({
		id: "view.toggleRightPanel",
		label: "Toggle Right Panel",
		category: "View",
		shortcut: { key: "d", meta: true, shift: true },
		execute: () => {
			const tabState = useTabStore.getState();
			if (tabState.rightPanel.open) {
				tabState.closeDiffPanel();
			} else {
				tabState.openRightPanel();
			}
		},
		keywords: ["changes", "working tree", "git diff", "explorer", "file tree"],
	});

	store.register({
		id: "view.toggleDiffMode",
		label: "Toggle Inline/Split Diff",
		category: "View",
		execute: () => {
			const tabState = useTabStore.getState();
			tabState.setDiffMode(tabState.diffMode === "split" ? "inline" : "split");
		},
		keywords: ["side by side", "unified"],
	});

	// ── Terminal ─────────────────────────────────────────────────────────────

	store.register({
		id: "terminal.new",
		label: "New Terminal",
		category: "Terminal",
		shortcut: { key: "t", meta: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			const { activeWorkspaceId, activeWorkspaceCwd, addTerminalTab } = useTabStore.getState();
			if (activeWorkspaceId) addTerminalTab(activeWorkspaceId, activeWorkspaceCwd);
		},
		keywords: ["terminal", "shell", "tab"],
	});

	store.register({
		id: "terminal.closeTab",
		label: "Close Tab",
		category: "Terminal",
		shortcut: { key: "w", meta: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			const tabState = useTabStore.getState();
			const wsId = tabState.activeWorkspaceId;
			if (!wsId) return;
			const paneState = usePaneStore.getState();
			const focused = paneState.getFocusedPane(wsId);
			if (focused?.activeTabId) {
				paneState.removeTabFromPane(wsId, focused.id, focused.activeTabId);
			}
		},
		keywords: ["close", "remove"],
	});

	// ── Pane ────────────────────────────────────────────────────────────────

	store.register({
		id: "pane.splitRight",
		label: "Split Pane Right",
		category: "Pane",
		shortcut: { key: "Backslash", meta: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			const wsId = useTabStore.getState().activeWorkspaceId;
			if (!wsId) return;
			const paneState = usePaneStore.getState();
			const focused = paneState.getFocusedPane(wsId);
			if (focused) paneState.splitPane(wsId, focused.id, "horizontal");
		},
		keywords: ["split", "horizontal", "divide"],
	});

	store.register({
		id: "pane.splitDown",
		label: "Split Pane Down",
		category: "Pane",
		shortcut: { key: "Backslash", meta: true, shift: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			const wsId = useTabStore.getState().activeWorkspaceId;
			if (!wsId) return;
			const paneState = usePaneStore.getState();
			const focused = paneState.getFocusedPane(wsId);
			if (focused) paneState.splitPane(wsId, focused.id, "vertical");
		},
		keywords: ["split", "vertical", "divide"],
	});

	store.register({
		id: "pane.close",
		label: "Close Pane",
		category: "Pane",
		shortcut: { key: "w", meta: true, shift: true },
		when: () => {
			const wsId = useTabStore.getState().activeWorkspaceId;
			if (!wsId) return false;
			const layout = usePaneStore.getState().getLayout(wsId);
			return layout?.type === "split";
		},
		execute: () => {
			const wsId = useTabStore.getState().activeWorkspaceId;
			if (!wsId) return;
			const paneState = usePaneStore.getState();
			const focused = paneState.getFocusedPane(wsId);
			if (focused) paneState.closePane(wsId, focused.id);
		},
		keywords: ["close", "remove pane"],
	});

	store.register({
		id: "pane.focusLeft",
		label: "Focus Pane Left",
		category: "Pane",
		shortcut: { key: "ArrowLeft", meta: true, alt: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => focusDirection("ArrowLeft"),
	});

	store.register({
		id: "pane.focusRight",
		label: "Focus Pane Right",
		category: "Pane",
		shortcut: { key: "ArrowRight", meta: true, alt: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => focusDirection("ArrowRight"),
	});

	store.register({
		id: "pane.focusUp",
		label: "Focus Pane Up",
		category: "Pane",
		shortcut: { key: "ArrowUp", meta: true, alt: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => focusDirection("ArrowUp"),
	});

	store.register({
		id: "pane.focusDown",
		label: "Focus Pane Down",
		category: "Pane",
		shortcut: { key: "ArrowDown", meta: true, alt: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => focusDirection("ArrowDown"),
	});

	store.register({
		id: "pane.nextTab",
		label: "Next Tab",
		category: "Pane",
		shortcut: { key: "BracketRight", meta: true, shift: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => cycleTab(1),
		keywords: ["next tab", "cycle"],
	});

	store.register({
		id: "pane.prevTab",
		label: "Previous Tab",
		category: "Pane",
		shortcut: { key: "BracketLeft", meta: true, shift: true },
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => cycleTab(-1),
		keywords: ["previous tab", "cycle"],
	});

	// ── Branch (palette-only) ───────────────────────────────────────────────

	store.register({
		id: "workspace.create",
		label: "Create Worktree",
		category: "Branch",
		when: () => useTabStore.getState().activeWorkspaceId !== null,
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:create-worktree"));
		},
		keywords: ["worktree", "new branch", "workspace", "create"],
	});

	// ── General (palette-only) ──────────────────────────────────────────────

	store.register({
		id: "general.checkUpdates",
		label: "Check for Updates",
		category: "General",
		execute: () => {
			window.dispatchEvent(new CustomEvent("app:check-updates"));
		},
		keywords: ["update", "version"],
	});
}
