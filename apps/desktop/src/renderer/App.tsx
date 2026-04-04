import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import type { LayoutNode, SerializedLayoutNode } from "../shared/pane-types";
import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { BranchActionMenu } from "./components/BranchActionMenu";
import { BranchPalette } from "./components/BranchPalette";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { DaemonStatus } from "./components/DaemonStatus";
import { DiffPanel } from "./components/DiffPanel";
import { LoginScreen } from "./components/LoginScreen";
import { MainContentArea } from "./components/MainContentArea";
import { SharedFilesPanel } from "./components/SharedFilesPanel";
import { Sidebar } from "./components/Sidebar";
import { UpdateToast } from "./components/UpdateToast";
import { WhatsNewModal } from "./components/WhatsNewModal";
import { useAgentAlertListener } from "./hooks/useAgentAlertListener";
import { usePaneShortcuts } from "./hooks/usePaneShortcuts";
import {
	setupDiagnosticsListener,
	setupGoToDefinitionHandler,
	setupServerRestartListener,
} from "./lsp/monaco-lsp-bridge";
import { useBranchStore } from "./stores/branch-store";
import { useEditorSettingsStore } from "./stores/editor-settings";
import { usePaneStore } from "./stores/pane-store";
import { useProjectStore } from "./stores/projects";
import type { TabItem } from "./stores/tab-store";
import { resetFileTabCounter, useTabStore } from "./stores/tab-store";
import { useUpdateStore } from "./stores/update-store";
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
				// Merge-conflict tabs are transient — the merge state doesn't survive restart
				if ((saved as { kind: string }).kind === "merge-conflict") {
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
	const { activeTicketProject } = store;
	if (activeTicketProject) {
		state["activeTicketProject"] = JSON.stringify(activeTicketProject);
	}

	const { vimEnabled } = useEditorSettingsStore.getState();
	if (vimEnabled) state["vimMode"] = "true";

	const paneLayouts: Record<string, string> = {};
	const layouts = usePaneStore.getState().layouts;
	for (const [wsId, layout] of Object.entries(layouts)) {
		paneLayouts[wsId] = JSON.stringify(serializeLayout(layout));
	}

	return { sessions, state, paneLayouts };
}

function dismissSplash() {
	const splash = document.getElementById("splash");
	if (splash) {
		splash.classList.add("hidden");
		setTimeout(() => splash.remove(), 300);
	}
}

export function App() {
	const sessionQuery = trpc.auth.getSession.useQuery(undefined, {
		retry: false,
		staleTime: 5 * 60 * 1000,
	});

	useEffect(() => {
		if (!sessionQuery.isLoading) {
			dismissSplash();
		}
	}, [sessionQuery.isLoading]);

	if (sessionQuery.isLoading) {
		// Splash screen in index.html handles the visual — render nothing here
		return null;
	}

	if (!sessionQuery.data) {
		return <LoginScreen />;
	}

	return <AuthenticatedApp />;
}

function AuthenticatedApp() {
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

		// Hydrate editor settings (independent of sessions/layouts)
		useEditorSettingsStore.getState().hydrateVimMode(state["vimMode"]);

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
	useAgentAlertListener();

	// Branch palette mutations and action menu state
	const utils = trpc.useUtils();
	const mergeStartMutation = trpc.merge.start.useMutation({
		onError: (err) => console.error("[App] merge.start failed:", err.message),
	});
	const rebaseStartMutation = trpc.rebase.start.useMutation({
		onError: (err) => console.error("[App] rebase.start failed:", err.message),
	});

	const [actionMenu, setActionMenu] = useState<{
		branch: string;
		currentBranch: string;
		position: { x: number; y: number };
	} | null>(null);

	const { openPalette, closePalette, isPaletteOpen, setMergeState } = useBranchStore();
	const isMerging = useBranchStore((s) => s.mergeState !== null);

	// Derive active projectId from the active workspace
	const activeWorkspaceId = useTabStore((s) => s.activeWorkspaceId);
	const activeWorkspaceQuery = trpc.workspaces.getById.useQuery(
		{ id: activeWorkspaceId ?? "" },
		{ enabled: !!activeWorkspaceId, staleTime: 30_000 }
	);
	const activeProjectId = activeWorkspaceQuery.data?.projectId ?? null;

	const workspacesQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId: activeProjectId ?? "" },
		{ enabled: !!activeProjectId }
	);

	const activeCwd = useTabStore((s) => s.activeWorkspaceCwd);
	const branchStatusQuery = trpc.branches.getStatus.useQuery(
		{ projectId: activeProjectId ?? "", cwd: activeCwd || undefined },
		{ enabled: !!activeProjectId }
	);

	function handleMerge(branch: string) {
		if (!activeProjectId) return;
		if (useBranchStore.getState().mergeState !== null) return;
		closePalette();
		setActionMenu(null);
		const cwd = useTabStore.getState().activeWorkspaceCwd || undefined;
		const currentBranch = branchStatusQuery.data?.branch ?? "";
		mergeStartMutation.mutate(
			{ projectId: activeProjectId, branch, cwd },
			{
				onSuccess: (result) => {
					utils.branches.getStatus.invalidate();
					if (result.status === "conflict" && result.files) {
						const workspaceId = useTabStore.getState().activeWorkspaceId ?? "";
						setMergeState({
							type: "merge",
							sourceBranch: branch,
							targetBranch: currentBranch,
							conflicts: result.files.map((path) => ({ path, status: "conflicting" as const })),
							activeFilePath: result.files[0] ?? null,
							rebaseProgress: null,
						});
						useTabStore.getState().openMergeConflict(workspaceId, "merge", branch, currentBranch);
					}
				},
			}
		);
	}

	function handleRebase(ontoBranch: string) {
		if (!activeProjectId) return;
		if (useBranchStore.getState().mergeState !== null) return;
		closePalette();
		setActionMenu(null);
		const cwd = useTabStore.getState().activeWorkspaceCwd || undefined;
		const currentBranch = branchStatusQuery.data?.branch ?? "";
		rebaseStartMutation.mutate(
			{ projectId: activeProjectId, ontoBranch, cwd },
			{
				onSuccess: (result) => {
					utils.branches.getStatus.invalidate();
					if (result.status === "conflict" && result.files) {
						const workspaceId = useTabStore.getState().activeWorkspaceId ?? "";
						setMergeState({
							type: "rebase",
							sourceBranch: ontoBranch,
							targetBranch: currentBranch,
							conflicts: result.files.map((path) => ({ path, status: "conflicting" as const })),
							activeFilePath: result.files[0] ?? null,
							rebaseProgress: result.progress ?? null,
						});
						useTabStore
							.getState()
							.openMergeConflict(workspaceId, "rebase", ontoBranch, currentBranch);
					}
				},
			}
		);
	}

	// Cmd+Shift+B — toggle branch palette
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "b" && e.metaKey && e.shiftKey) {
				e.preventDefault();
				if (isPaletteOpen) {
					closePalette();
				} else if (activeProjectId) {
					openPalette();
				}
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isPaletteOpen, openPalette, closePalette, activeProjectId]);

	// Query update status on mount and poll when an update is being downloaded
	const updateStore = useUpdateStore();
	const isDownloading = updateStore.toastState === "downloading";
	const updateStatus = trpc.updates.getStatus.useQuery(undefined, {
		staleTime: isDownloading ? 5_000 : Number.POSITIVE_INFINITY,
		refetchInterval: isDownloading ? 5_000 : false,
		refetchOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	const hasCheckedUpdate = useRef(false);
	useEffect(() => {
		const data = updateStatus.data;
		if (!data) return;

		// One-time: process pending notification from startup
		if (!hasCheckedUpdate.current) {
			hasCheckedUpdate.current = true;
			if (data.pendingNotification) {
				const { type, version, summary } = data.pendingNotification;
				const toastType = type === "patch" ? "patch" : "new-version";
				useUpdateStore.getState().showToast(toastType, version, summary);
			}
		}

		// Sync download/ready state from main process
		if (data.updateDownloaded && data.updateVersion) {
			useUpdateStore.getState().setUpdateReady(data.updateVersion);
		} else if (data.updateAvailable && data.downloadProgress != null && data.updateVersion) {
			useUpdateStore.getState().setDownloadProgress(data.downloadProgress);
		}
	}, [updateStatus.data]);

	const sidebarPanelRef = usePanelRef();
	const diffPanelRef = usePanelRef();
	const setSidebarCollapsed = useProjectStore((s) => s.setSidebarCollapsed);
	const sidebarCollapsed = useProjectStore((s) => s.sidebarCollapsed);
	const rightPanelOpen = useTabStore((s) => s.rightPanel.open);
	const sidebarSegment = useTabStore((s) => s.sidebarSegment);
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);
	const openRightPanel = useTabStore((s) => s.openRightPanel);
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: "app-layout",
		storage: localStorage,
	});

	// Sync panel collapse/expand with store state.
	// Always collapse when on tickets segment — the diff panel is not relevant.
	useEffect(() => {
		if (!diffPanelRef.current) return;
		if (sidebarSegment === "tickets") {
			if (!diffPanelRef.current.isCollapsed()) diffPanelRef.current.collapse();
			return;
		}
		if (rightPanelOpen && diffPanelRef.current.isCollapsed()) {
			diffPanelRef.current.expand();
		} else if (!rightPanelOpen && !diffPanelRef.current.isCollapsed()) {
			diffPanelRef.current.collapse();
		}
	}, [rightPanelOpen, diffPanelRef, sidebarSegment]);

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
					minSize={200}
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
			{!rightPanelOpen && sidebarSegment !== "tickets" && (
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
			{activeProjectId && (
				<BranchPalette
					projectId={activeProjectId}
					onOpenActionMenu={(branch, currentBranch, position) => {
						setActionMenu({ branch, currentBranch, position });
					}}
				/>
			)}
			{activeProjectId && actionMenu && (
				<BranchActionMenu
					projectId={activeProjectId}
					branch={actionMenu.branch}
					currentBranch={actionMenu.currentBranch}
					position={actionMenu.position}
					onClose={() => setActionMenu(null)}
					onMerge={handleMerge}
					onRebase={handleRebase}
					isMerging={isMerging}
				/>
			)}
		</>
	);
}
