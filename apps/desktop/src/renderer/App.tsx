import { useEffect, useRef, useState } from "react";
import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { DiffPanel } from "./components/DiffPanel";
import { MainContentArea } from "./components/MainContentArea";
import { Sidebar } from "./components/Sidebar";
import { scrollbackRegistry } from "./components/Terminal";
import {
	setupDiagnosticsListener,
	setupGoToDefinitionHandler,
} from "./lsp/monaco-lsp-bridge";
import { useTabStore } from "./stores/tab-store";
import { trpc } from "./trpc/client";

const SAVE_INTERVAL_MS = 30_000;

function collectSnapshot() {
	const { tabs, activeTabId, activeWorkspaceId, activeWorkspaceCwd } = useTabStore.getState();

	const terminalTabs = tabs.filter((t) => t.kind === "terminal" && t.workspaceId);
	const sessions = terminalTabs.map((tab, i) => ({
		id: tab.id,
		workspaceId: tab.workspaceId,
		title: tab.title,
		cwd: tab.kind === "terminal" ? tab.cwd : "",
		scrollback: scrollbackRegistry.get(tab.id)?.() ?? null,
		sortOrder: i,
	}));

	const state: Record<string, string> = {};
	if (activeTabId) state["activeTabId"] = activeTabId;
	if (activeWorkspaceId) state["activeWorkspaceId"] = activeWorkspaceId;
	if (activeWorkspaceCwd) state["activeWorkspaceCwd"] = activeWorkspaceCwd;

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
				state["activeWorkspaceCwd"] ?? ""
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

	// LSP diagnostics listener and go-to-definition handler
	useEffect(() => {
		setupDiagnosticsListener();
		setupGoToDefinitionHandler();
	}, []);

	return (
		<>
			<div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
				<Sidebar />
				<MainContentArea savedScrollback={savedScrollback} />
				<DiffPanel />
			</div>
			<AddRepositoryModal />
			<CreateWorktreeModal />
		</>
	);
}
