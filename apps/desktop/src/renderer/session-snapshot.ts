import type { LayoutNode, SerializedLayoutNode } from "../shared/pane-types";
import type { SessionSaveData } from "../shared/types";
import { useEditorSettingsStore } from "./stores/editor-settings";
import { usePaneStore } from "./stores/pane-store";
import { useProjectStore } from "./stores/projects";
import { type TabItem, serializeHermesSessionSelection, useTabStore } from "./stores/tab-store";

export type SessionSnapshot = SessionSaveData & {
	paneLayouts: Record<string, string>;
};

function serializeLayout(node: LayoutNode): SerializedLayoutNode {
	if (node.type === "pane") {
		return {
			type: "pane",
			id: node.id,
			tabs: node.tabs.map((tab) =>
				tab.kind === "file" ? { ...tab, initialPosition: undefined } : tab
			),
			activeTabId: node.activeTabId,
		};
	}
	return {
		type: "split",
		id: node.id,
		direction: node.direction,
		ratio: node.ratio,
		children: [serializeLayout(node.children[0]), serializeLayout(node.children[1])],
	};
}

export function deserializeLayout(
	node: SerializedLayoutNode,
	terminalMap: Map<string, TabItem>
): LayoutNode | null {
	if (node.type === "pane") {
		const paneTabs = node.tabs
			.map((saved): TabItem | null => {
				if (saved.kind === "terminal") {
					const terminal = terminalMap.get(saved.id);
					if (terminal?.kind !== "terminal" || terminal.workspaceId !== saved.workspaceId)
						return null;
					// The backend owns session identity and cwd; the layout owns UI metadata.
					return { ...terminal, presetName: saved.presetName ?? terminal.presetName };
				}
				// Filter out stale ai-review-summary tabs from previous versions
				if ((saved as { kind: string }).kind === "ai-review-summary") {
					return null;
				}
				// Merge-conflict tabs are transient — the merge state doesn't survive restart
				if ((saved as { kind: string }).kind === "merge-conflict") {
					return null;
				}
				// Solve-review tabs are transient — solve sessions don't survive restart
				if ((saved as { kind: string }).kind === "solve-review") {
					return null;
				}
				// Cross-repo orchestrator canvas tabs are re-opened on demand, not restored
				if ((saved as { kind: string }).kind === "xro-canvas") {
					return null;
				}
				// File tabs: use directly from serialized data
				return saved;
			})
			.filter((t): t is TabItem => t != null);
		if (paneTabs.length === 0) return null;
		return {
			type: "pane",
			id: node.id,
			tabs: paneTabs,
			activeTabId: paneTabs.find((t) => t.id === node.activeTabId)?.id ?? paneTabs[0]?.id ?? null,
		};
	}
	const first = deserializeLayout(node.children[0], terminalMap);
	const second = deserializeLayout(node.children[1], terminalMap);
	if (!first || !second) return first || second || null;
	return {
		type: "split",
		id: node.id,
		direction: node.direction,
		ratio: node.ratio,
		children: [first, second],
	};
}

export function collectSessionSnapshot(): SessionSnapshot {
	const store = useTabStore.getState();
	const { activeWorkspaceId, activeWorkspaceCwd, baseBranchByWorkspace, diffMode } = store;
	const tabs = store.getAllTabs();
	const activeTabId = store.getActiveTabId();

	const terminalTabs = tabs.filter((tab) => tab.kind === "terminal" && tab.workspaceId);
	const sessions = terminalTabs.map((tab, index) => ({
		id: tab.id,
		workspaceId: tab.workspaceId,
		title: tab.title,
		cwd: tab.kind === "terminal" ? tab.cwd : "",
		// scrollback omitted — daemon owns that column
		sortOrder: index,
	}));

	const state: Record<string, string> = {};
	if (activeTabId) state["activeTabId"] = activeTabId;
	if (activeWorkspaceId) state["activeWorkspaceId"] = activeWorkspaceId;
	if (activeWorkspaceCwd) state["activeWorkspaceCwd"] = activeWorkspaceCwd;
	state["diffMode"] = diffMode;
	if (Object.keys(baseBranchByWorkspace).length > 0) {
		state["baseBranchByWorkspace"] = JSON.stringify(baseBranchByWorkspace);
	}
	const {
		sidebarSegment,
		activeWorkspaceBySegment,
		workspaceMetadata,
		selectedHermesSession,
		hermesSessionPane,
	} = store;
	if (sidebarSegment) state["sidebarSegment"] = sidebarSegment;
	state["activeWorkspaceBySegment"] = JSON.stringify(activeWorkspaceBySegment);
	const serializedHermesSession = serializeHermesSessionSelection(selectedHermesSession);
	if (serializedHermesSession) state["selectedHermesSession"] = serializedHermesSession;
	state["hermesSessionPane"] = hermesSessionPane;
	if (Object.keys(workspaceMetadata).length > 0) {
		state["workspaceMetadata"] = JSON.stringify(workspaceMetadata);
	}
	const { activeTicketProject, activeTicketScope } = store;
	if (activeTicketProject) {
		state["activeTicketProject"] = JSON.stringify(activeTicketProject);
	}
	state["activeTicketScope"] = JSON.stringify(activeTicketScope);

	const { expandedProjectIds } = useProjectStore.getState();
	if (expandedProjectIds.size > 0) {
		state["expandedProjectIds"] = JSON.stringify([...expandedProjectIds]);
	}

	const { vimEnabled, notificationSoundsEnabled } = useEditorSettingsStore.getState();
	if (vimEnabled) state["vimMode"] = "true";
	state["notificationSounds"] = notificationSoundsEnabled ? "true" : "false";

	const paneLayouts: Record<string, string> = {};
	for (const [workspaceId, layout] of Object.entries(usePaneStore.getState().layouts)) {
		paneLayouts[workspaceId] = JSON.stringify(serializeLayout(layout));
	}

	return { sessions, state, paneLayouts };
}

export function isSessionSnapshotPersistable(
	snapshot: SessionSaveData,
	context: { rendererOwnsPersistedState?: boolean } = {}
): boolean {
	return (
		snapshot.sessions.length > 0 ||
		Object.keys(snapshot.paneLayouts ?? {}).length > 0 ||
		snapshot.state["sidebarSegment"] === "hermes" ||
		context.rendererOwnsPersistedState === true
	);
}
