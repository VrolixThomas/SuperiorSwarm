import { useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { FileTreePanel } from "./components/FileTreePanel";
import { MainContentArea } from "./components/MainContentArea";
import { Sidebar } from "./components/Sidebar";
import { scrollbackRegistry } from "./components/Terminal";
import { useDiffStore } from "./stores/diff";
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
	// Track scrollback per tab id for restored sessions
	const [savedScrollback, setSavedScrollback] = useState<Record<string, string>>({});
	const activeDiff = useDiffStore((s) => s.activeDiff);

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
			<div className="flex h-screen overflow-hidden bg-[var(--bg-base)]">
				<Sidebar />
				{activeDiff ? (
					<Group orientation="horizontal" className="flex min-w-0 flex-1 overflow-hidden">
						<Panel defaultSize={20} minSize={14} maxSize={35}>
							<FileTreePanel />
						</Panel>
						<Separator className="w-px bg-[var(--border)] hover:bg-[var(--accent)] cursor-col-resize transition-colors" />
						<Panel>
							<MainContentArea savedScrollback={savedScrollback} />
						</Panel>
					</Group>
				) : (
					<MainContentArea savedScrollback={savedScrollback} />
				)}
			</div>
			<AddRepositoryModal />
			<CreateWorktreeModal />
		</>
	);
}
