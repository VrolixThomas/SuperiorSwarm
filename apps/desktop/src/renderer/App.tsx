import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { TerminalTabs } from "./components/TerminalTabs";
import { useTerminalStore } from "./stores/terminal";

export function App() {
	const visibleTabs = useTerminalStore((s) => s.getVisibleTabs());
	const activeTabId = useTerminalStore((s) => s.activeTabId);
	const activeWorkspaceId = useTerminalStore((s) => s.activeWorkspaceId);

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
								<Terminal id={tab.id} cwd={tab.cwd || undefined} />
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
