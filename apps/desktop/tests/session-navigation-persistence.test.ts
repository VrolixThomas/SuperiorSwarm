import { beforeEach, describe, expect, test } from "bun:test";
import {
	collectSessionSnapshot,
	isSessionSnapshotPersistable,
} from "../src/renderer/session-snapshot";
import { useEditorSettingsStore } from "../src/renderer/stores/editor-settings";
import { usePaneStore } from "../src/renderer/stores/pane-store";
import { useProjectStore } from "../src/renderer/stores/projects";
import {
	PANEL_CLOSED,
	resolveAvailableHermesSelection,
	useTabStore,
} from "../src/renderer/stores/tab-store";
import type { HermesSessionPane } from "../src/shared/hermes";
import type { SessionSaveData } from "../src/shared/types";

const selection = {
	connectionId: "connection-task-first",
	sessionId: "session-task-first",
};

function resetStores(): void {
	usePaneStore.setState({ layouts: {}, focusedPaneId: null });
	useProjectStore.setState({ expandedProjectIds: new Set() });
	useEditorSettingsStore.setState({ vimEnabled: false, notificationSoundsEnabled: true });
	useTabStore.setState({
		activeWorkspaceId: null,
		activeWorkspaceCwd: "",
		baseBranchByWorkspace: {},
		diffMode: "split",
		rightPanel: PANEL_CLOSED,
		workspaceMetadata: {},
		sidebarSegment: "repos",
		activeWorkspaceBySegment: { repos: null, tickets: null, prs: null, hermes: null },
		selectedHermesSession: null,
		hermesSessionPane: "chat",
		activeTicketProject: "all",
		activeTicketScope: { kind: "current" },
	});
}

function emptySnapshot(): SessionSaveData {
	return {
		sessions: [],
		state: { sidebarSegment: "repos" },
		paneLayouts: {},
	};
}

describe("session navigation persistence", () => {
	beforeEach(resetStores);

	test("collects and persists task-first Agents state without terminals or layouts", () => {
		useTabStore.setState({
			sidebarSegment: "hermes",
			selectedHermesSession: selection,
			hermesSessionPane: "worktrees",
		});

		const snapshot = collectSessionSnapshot();

		expect(snapshot.sessions).toEqual([]);
		expect(snapshot.paneLayouts).toEqual({});
		expect(isSessionSnapshotPersistable(snapshot)).toBe(true);
		expect(snapshot.state["sidebarSegment"]).toBe("hermes");
		expect(JSON.parse(snapshot.state["selectedHermesSession"] ?? "null")).toEqual(selection);
		expect(snapshot.state["hermesSessionPane"]).toBe("worktrees");
	});

	test("round-trips both Agents panes", () => {
		for (const pane of ["chat", "worktrees"] satisfies HermesSessionPane[]) {
			resetStores();
			useTabStore.setState({
				sidebarSegment: "hermes",
				selectedHermesSession: selection,
				hermesSessionPane: pane,
			});
			const snapshot = collectSessionSnapshot();

			resetStores();
			useTabStore.getState().hydrate([], null, null, "", snapshot.state);

			expect(useTabStore.getState().selectedHermesSession).toEqual(selection);
			expect(useTabStore.getState().hermesSessionPane).toBe(pane);
		}
	});

	test("falls back safely for malformed and unavailable saved selections", () => {
		useTabStore.getState().hydrate([], null, "stale-workspace", "/repos/stale", {
			sidebarSegment: "hermes",
			selectedHermesSession: '{"connectionId":"connection-task-first"}',
			hermesSessionPane: "malformed",
		});

		expect(useTabStore.getState().sidebarSegment).toBe("hermes");
		expect(useTabStore.getState().selectedHermesSession).toBeNull();
		expect(useTabStore.getState().hermesSessionPane).toBe("chat");
		expect(useTabStore.getState().activeWorkspaceId).toBeNull();
		expect(useTabStore.getState().activeWorkspaceCwd).toBe("");
		expect(resolveAvailableHermesSelection(selection, [], undefined)).toBeNull();
		expect(resolveAvailableHermesSelection(selection, [selection.connectionId], [])).toBeNull();
	});

	test("keeps the existing repo and workspace persistence gate", () => {
		const repoOnly = emptySnapshot();
		expect(isSessionSnapshotPersistable(repoOnly)).toBe(false);

		expect(
			isSessionSnapshotPersistable({
				...repoOnly,
				sessions: [
					{
						id: "terminal-1",
						workspaceId: "workspace-1",
						title: "Terminal",
						cwd: "/repos/project",
						sortOrder: 0,
					},
				],
			})
		).toBe(true);
		expect(
			isSessionSnapshotPersistable({
				...repoOnly,
				paneLayouts: { "workspace-1": '{"type":"pane"}' },
			})
		).toBe(true);
	});
});
