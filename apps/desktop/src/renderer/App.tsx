import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { DaemonStatus } from "./components/DaemonStatus";
import { DiffPanel } from "./components/DiffPanel";
import { MainContentArea } from "./components/MainContentArea";
import { SharedFilesPanel } from "./components/SharedFilesPanel";
import { Sidebar } from "./components/Sidebar";
import {
	setupDiagnosticsListener,
	setupGoToDefinitionHandler,
	setupServerRestartListener,
} from "./lsp/monaco-lsp-bridge";
import { useProjectStore } from "./stores/projects";
import { useTabStore } from "./stores/tab-store";
import { trpc } from "./trpc/client";

const SAVE_INTERVAL_MS = 30_000;

function collectSnapshot() {
	const { tabs, activeTabId, activeWorkspaceId, activeWorkspaceCwd, baseBranchByWorkspace } =
		useTabStore.getState();

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

	return { sessions, state };
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

		const { sessions, state } = restoreQuery.data;
		if (sessions.length === 0) return;

		const scrollbacks: Record<string, string> = {};
		for (const session of sessions) {
			if (session.scrollback) {
				scrollbacks[session.id] = session.scrollback;
			}
		}
		setSavedScrollback(scrollbacks);

		useTabStore
			.getState()
			.hydrate(
				sessions,
				state["activeTabId"] ?? null,
				state["activeWorkspaceId"] ?? null,
				state["activeWorkspaceCwd"] ?? "",
				state
			);
	}, [restoreQuery.data]);

	// Periodic save
	useEffect(() => {
		const interval = setInterval(() => {
			const snapshot = collectSnapshot();
			if (snapshot.sessions.length > 0) {
				saveMutateRef.current(snapshot);
			}
		}, SAVE_INTERVAL_MS);

		return () => clearInterval(interval);
	}, []);

	// Save on quit (sync IPC)
	useEffect(() => {
		const handleBeforeUnload = () => {
			const snapshot = collectSnapshot();
			if (snapshot.sessions.length > 0) {
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
		</>
	);
}
