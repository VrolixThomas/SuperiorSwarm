import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { Sidebar } from "./components/Sidebar";
import { Terminal, scrollbackRegistry } from "./components/Terminal";
import { TerminalTabs } from "./components/TerminalTabs";
import { useTerminalStore } from "./stores/terminal";
import { trpc } from "./trpc/client";

const SAVE_INTERVAL_MS = 30_000;

function collectSnapshot() {
	const { tabs, activeTabId, activeWorkspaceId, activeWorkspaceCwd } = useTerminalStore.getState();

	const sessions = tabs
		.filter((tab) => tab.workspaceId)
		.map((tab, i) => ({
			id: tab.id,
			workspaceId: tab.workspaceId,
			title: tab.title,
			cwd: tab.cwd,
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
	const visibleTabs = useTerminalStore(useShallow((s) => s.getVisibleTabs()));
	const activeTabId = useTerminalStore((s) => s.activeTabId);
	const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId);

	// Track scrollback per tab id for restored sessions
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

		useTerminalStore
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

	return (
		<>
			<div className="flex h-screen bg-[var(--bg-base)]">
				<Sidebar />
				<main className="flex min-w-0 flex-1 flex-col">
					<TerminalTabs />
					<div className="relative flex-1 overflow-hidden">
						{!activeWorkspaceId && (
							<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
								Select a workspace to open a terminal
							</div>
						)}
						{activeWorkspaceId && visibleTabs.length === 0 && (
							<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
								No terminals open — click + to create one
							</div>
						)}
						{visibleTabs.map((tab) => (
							<div
								key={tab.id}
								className={`absolute inset-0 ${tab.id === activeTabId ? "visible" : "invisible"}`}
							>
								<Terminal
									id={tab.id}
									cwd={tab.cwd || undefined}
									initialContent={savedScrollback[tab.id]}
								/>
							</div>
						))}
					</div>
				</main>
			</div>
			<AddRepositoryModal />
			<CreateWorktreeModal />
		</>
	);
}
