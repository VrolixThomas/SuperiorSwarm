import type { LayoutNode, SerializedLayoutNode } from "../shared/pane-types";
import type { SessionSaveData } from "../shared/types";
import { useEditorSettingsStore } from "./stores/editor-settings";
import { usePaneStore } from "./stores/pane-store";
import { useProjectStore } from "./stores/projects";
import { serializeHermesSessionSelection, useTabStore } from "./stores/tab-store";

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
