import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import type { LayoutNode, SerializedLayoutNode } from "../shared/pane-types";
import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { DaemonStatus } from "./components/DaemonStatus";
import { UpdateToast } from "./components/UpdateToast";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { DiffPanel } from "./components/DiffPanel";
import { MainContentArea } from "./components/MainContentArea";
import { SharedFilesPanel } from "./components/SharedFilesPanel";
import { Sidebar } from "./components/Sidebar";
import { usePaneShortcuts } from "./hooks/usePaneShortcuts";
import {
	setupDiagnosticsListener,
	setupGoToDefinitionHandler,
	setupServerRestartListener,
} from "./lsp/monaco-lsp-bridge";
import { usePaneStore } from "./stores/pane-store";
import { useProjectStore } from "./stores/projects";
import { useUpdateStore } from "./stores/update-store";
import type { TabItem } from "./stores/tab-store";
import { resetFileTabCounter, useTabStore } from "./stores/tab-store";
import { trpc } from "./trpc/client";

const SAVE_INTERVAL_MS = 30_000;

function serializeLayout(node: LayoutNode): SerializedLayoutNode {
	if (node.type === "pane") {
		return {
			type: "pane",
			id: node.id,
			tabs: node.tabs.map((t) => (t.kind === "file" ? { ...t, initialPosition: undefined } : t)),
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

function deserializeLayout(
	node: SerializedLayoutNode,
	terminalMap: Map<string, TabItem>
): LayoutNode | null {
	if (node.type === "pane") {
		const paneTabs = node.tabs
			.map((saved) => {
				if (saved.kind === "terminal") {
					// Terminal tabs: use fresh session data from backend
					return terminalMap.get(saved.id) ?? null;
				}
				// Filter out stale ai-review-summary tabs from previous versions
				if ((saved as { kind: string }).kind === "ai-review-summary") {
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

function extractMaxIds(node: LayoutNode): {
	maxPaneId: number;
	maxSplitId: number;
	maxFileTabId: number;
} {
	if (node.type === "pane") {
		const match = node.id.match(/^pane-(\d+)$/);
		let maxFileTabId = 0;
		for (const tab of node.tabs) {
			const ftMatch = tab.id.match(/^file-tab-(\d+)$/);
			if (ftMatch) maxFileTabId = Math.max(maxFileTabId, Number(ftMatch[1]));
		}
		return { maxPaneId: match ? Number(match[1]) : 0, maxSplitId: 0, maxFileTabId };
	}
	const splitMatch = node.id.match(/^split-(\d+)$/);
	const splitId = splitMatch ? Number(splitMatch[1]) : 0;
	const left = extractMaxIds(node.children[0]);
	const right = extractMaxIds(node.children[1]);
	return {
		maxPaneId: Math.max(left.maxPaneId, right.maxPaneId),
		maxSplitId: Math.max(splitId, left.maxSplitId, right.maxSplitId),
		maxFileTabId: Math.max(left.maxFileTabId, right.maxFileTabId),
	};
}

function collectSnapshot() {
	const store = useTabStore.getState();
	const { activeWorkspaceId, activeWorkspaceCwd, baseBranchByWorkspace } = store;
	const tabs = store.getAllTabs();
	const activeTabId = store.getActiveTabId();

	const terminalTabs = tabs.filter((t) => t.kind === "terminal" && t.workspaceId);
	const sessions = terminalTabs.map((tab, i) => ({
		id: tab.id,
		workspaceId: tab.workspaceId,
		title: tab.title,
		cwd: tab.kind === "terminal" ? tab.cwd : "",
		// scrollback omitted — daemon owns that column
		sortOrder: i,
	}));

	const state: Record<string, string> = {};
	if (activeTabId) state["activeTabId"] = activeTabId;
	if (activeWorkspaceId) state["activeWorkspaceId"] = activeWorkspaceId;
	if (activeWorkspaceCwd) state["activeWorkspaceCwd"] = activeWorkspaceCwd;
	if (Object.keys(baseBranchByWorkspace).length > 0) {
		state["baseBranchByWorkspace"] = JSON.stringify(baseBranchByWorkspace);
	}
	const { sidebarSegment, activeWorkspaceBySegment, workspaceMetadata } = store;
	if (sidebarSegment) state["sidebarSegment"] = sidebarSegment;
	state["activeWorkspaceBySegment"] = JSON.stringify(activeWorkspaceBySegment);
	if (Object.keys(workspaceMetadata).length > 0) {
		state["workspaceMetadata"] = JSON.stringify(workspaceMetadata);
	}

	const paneLayouts: Record<string, string> = {};
	const layouts = usePaneStore.getState().layouts;
	for (const [wsId, layout] of Object.entries(layouts)) {
		paneLayouts[wsId] = JSON.stringify(serializeLayout(layout));
	}

	return { sessions, state, paneLayouts };
}

export function App() {
	const [savedScrollback, setSavedScrollback] = useState<Record<string, string>>({});

	const saveMutation = trpc.terminalSessions.save.useMutation();
	const saveMutateRef = useRef(saveMutation.mutate);
	saveMutateRef.current = saveMutation.mutate;
	const restoreQuery = trpc.terminalSessions.restore.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	// Restore session on first load
	const hasRestored = useRef(false);
	useEffect(() => {
		if (hasRestored.current || !restoreQuery.data) return;
		hasRestored.current = true;

		const { sessions, state, paneLayouts, workspaceMeta } = restoreQuery.data;
		const hasSessions = sessions.length > 0;
		const hasLayouts = paneLayouts && Object.keys(paneLayouts).length > 0;
		if (!hasSessions && !hasLayouts) return;

		const scrollbacks: Record<string, string> = {};
		for (const session of sessions) {
			if (session.scrollback) {
				scrollbacks[session.id] = session.scrollback;
			}
		}
		setSavedScrollback(scrollbacks);

		if (hasSessions) {
			useTabStore
				.getState()
				.hydrate(
					sessions,
					state["activeTabId"] ?? null,
					state["activeWorkspaceId"] ?? null,
					state["activeWorkspaceCwd"] ?? "",
					state
				);
		}

		// Backfill workspace metadata from backend for workspaces not already saved client-side
		if (workspaceMeta) {
			const tabState = useTabStore.getState();
			for (const [wsId, meta] of Object.entries(workspaceMeta)) {
				if (!tabState.workspaceMetadata[wsId]) {
					tabState.setWorkspaceMetadata(wsId, {
						type: meta.type === "review" ? "review" : meta.type,
						prProvider: meta.prProvider,
						prIdentifier: meta.prIdentifier,
					});
				}
			}
		}

		// Hydrate pane layouts (must happen after tab hydration so terminal tabs exist)
		if (hasLayouts) {
			const paneState = usePaneStore.getState();

			// Build terminal tab lookup from hydrated pane-store layouts
			const terminalMap = new Map<string, TabItem>();
			for (const root of Object.values(paneState.layouts)) {
				const collectTabs = (n: LayoutNode): void => {
					if (n.type === "pane") {
						for (const tab of n.tabs) terminalMap.set(tab.id, tab);
						return;
					}
					collectTabs(n.children[0]);
					collectTabs(n.children[1]);
				};
				collectTabs(root);
			}

			let maxPaneId = 0;
			let maxSplitId = 0;
			let maxFileTabId = 0;

			for (const [wsId, layoutJson] of Object.entries(paneLayouts)) {
				if (workspaceMeta && !workspaceMeta[wsId]) {
					// Orphaned layout — workspace no longer exists, skip it
					continue;
				}
				try {
					const serialized = JSON.parse(layoutJson) as SerializedLayoutNode;
					const layout = deserializeLayout(serialized, terminalMap);
					if (layout) {
						paneState.hydrateLayout(wsId, layout);
						const ids = extractMaxIds(layout);
						maxPaneId = Math.max(maxPaneId, ids.maxPaneId);
						maxSplitId = Math.max(maxSplitId, ids.maxSplitId);
						maxFileTabId = Math.max(maxFileTabId, ids.maxFileTabId);
					}
				} catch (e) {
					console.warn(`Failed to restore pane layout for workspace ${wsId}:`, e);
				}
			}

			paneState.resetCounters(maxPaneId, maxSplitId);
			resetFileTabCounter(maxFileTabId);
		}
	}, [restoreQuery.data]);

	// Periodic save
	useEffect(() => {
		const interval = setInterval(() => {
			const snapshot = collectSnapshot();
			if (snapshot.sessions.length > 0 || Object.keys(snapshot.paneLayouts).length > 0) {
				saveMutateRef.current(snapshot);
			}
		}, SAVE_INTERVAL_MS);

		return () => clearInterval(interval);
	}, []);

	// Save on quit (sync IPC)
	useEffect(() => {
		const handleBeforeUnload = () => {
			const snapshot = collectSnapshot();
			if (snapshot.sessions.length > 0 || Object.keys(snapshot.paneLayouts).length > 0) {
				window.electron.session.saveSync(snapshot);
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, []);

	// LSP diagnostics listener, go-to-definition handler, and crash restart listener
	useEffect(() => {
		setupDiagnosticsListener();
		const cleanupGotoDef = setupGoToDefinitionHandler();
		const cleanupRestartListener = setupServerRestartListener();
		return () => {
			cleanupGotoDef();
			cleanupRestartListener();
		};
	}, []);

	usePaneShortcuts();

	// Query update status on mount and trigger toast if needed
	const updateStatus = trpc.updates.getStatus.useQuery(undefined, {
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const hasCheckedUpdate = useRef(false);
	useEffect(() => {
		if (hasCheckedUpdate.current || !updateStatus.data) return;
		hasCheckedUpdate.current = true;

		const { pendingNotification, updateAvailable, updateVersion, downloadProgress, updateDownloaded } =
			updateStatus.data;

		if (pendingNotification) {
			const { type, version, summary } = pendingNotification;
			const toastType = type === "patch" ? "patch" : "new-version";
			useUpdateStore.getState().showToast(toastType as "new-version" | "patch", version, summary);
		}

		if (updateDownloaded && updateVersion) {
			useUpdateStore.getState().setUpdateReady(updateVersion);
		} else if (downloadProgress != null && updateVersion) {
			useUpdateStore.getState().setDownloadProgress(downloadProgress);
		}
	}, [updateStatus.data]);

	const sidebarPanelRef = usePanelRef();
	const diffPanelRef = usePanelRef();
	const setSidebarCollapsed = useProjectStore((s) => s.setSidebarCollapsed);
	const sidebarCollapsed = useProjectStore((s) => s.sidebarCollapsed);
	const rightPanelOpen = useTabStore((s) => s.rightPanel.open);
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);
	const openRightPanel = useTabStore((s) => s.openRightPanel);
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: "app-layout",
		storage: localStorage,
	});

	// Sync panel collapse/expand with store state
	useEffect(() => {
		if (!diffPanelRef.current) return;
		if (rightPanelOpen && diffPanelRef.current.isCollapsed()) {
			diffPanelRef.current.expand();
		} else if (!rightPanelOpen && !diffPanelRef.current.isCollapsed()) {
			diffPanelRef.current.collapse();
		}
	}, [rightPanelOpen, diffPanelRef]);

	return (
		<>
			<Group
				orientation="horizontal"
				defaultLayout={defaultLayout}
				onLayoutChanged={onLayoutChanged}
				className="h-screen overflow-hidden bg-[var(--bg-base)]"
			>
				<Panel
					id="sidebar"
					panelRef={sidebarPanelRef}
					defaultSize="15.3%"
					minSize="12.5%"
					maxSize="27.8%"
					collapsible
					collapsedSize="3.9%"
					onResize={() => {
						const isCollapsed = sidebarPanelRef.current?.isCollapsed() ?? false;
						setSidebarCollapsed(isCollapsed);
					}}
					className="overflow-hidden bg-[var(--bg-surface)]"
				>
					<Sidebar
						collapsed={sidebarCollapsed}
						onExpand={() => sidebarPanelRef.current?.expand()}
					/>
				</Panel>

				<Separator className="panel-resize-handle" />

				<Panel id="main" minSize="30%">
					<MainContentArea savedScrollback={savedScrollback} />
				</Panel>

				<Separator className="panel-resize-handle" />
				<Panel
					id="diff"
					panelRef={diffPanelRef}
					defaultSize="19.4%"
					minSize="10%"
					maxSize="40%"
					collapsible
					collapsedSize="0%"
					onResize={() => {
						const collapsed = diffPanelRef.current?.isCollapsed() ?? false;
						if (collapsed && rightPanelOpen) closeDiffPanel();
					}}
				>
					<DiffPanel onClose={closeDiffPanel} />
				</Panel>
			</Group>
			{!rightPanelOpen && (
				<button
					type="button"
					onClick={openRightPanel}
					className="fixed top-1/2 right-0 z-10 -translate-y-1/2 rounded-l-md border border-r-0 border-[var(--border)] bg-[var(--bg-surface)] px-1 py-5 text-[var(--text-quaternary)] transition-colors duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					title="Open panel"
				>
					<svg
						width="8"
						height="14"
						viewBox="0 0 8 14"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M7 1L1 7l6 6" />
					</svg>
				</button>
			)}
			<AddRepositoryModal />
			<CreateWorktreeModal />
			<SharedFilesPanel />
			<DaemonStatus />
			<UpdateToast />
			<WhatsNewModal />
		</>
	);
}
