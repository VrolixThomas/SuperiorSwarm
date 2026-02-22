import { AddRepositoryModal } from "./components/AddRepositoryModal";
import { CreateWorktreeModal } from "./components/CreateWorktreeModal";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { TerminalTabs } from "./components/TerminalTabs";
import { useTerminalStore } from "./stores/terminal";

export function App() {
	const { tabs, activeTabId } = useTerminalStore();

	return (
		<>
			<div className="flex h-screen bg-[var(--bg-base)]">
				<Sidebar />
				<main className="flex min-w-0 flex-1 flex-col">
					<TerminalTabs />
					<div className="relative flex-1 overflow-hidden">
						{tabs.length === 0 && (
							<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
								Select a workspace to open a terminal
							</div>
						)}
						{tabs.map((tab) => (
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
