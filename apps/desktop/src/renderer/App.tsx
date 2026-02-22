import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Terminal } from "./components/Terminal";
import { TerminalTabs } from "./components/TerminalTabs";
import { useTerminalStore } from "./stores/terminal";

export function App() {
	const { tabs, activeTabId } = useTerminalStore();

	useEffect(() => {
		const { addTab, removeTab } = useTerminalStore.getState();
		const id = addTab();
		return () => removeTab(id);
	}, []);

	return (
		<div className="flex h-screen bg-[var(--bg-base)]">
			<Sidebar />
			<main className="flex min-w-0 flex-1 flex-col">
				<TerminalTabs />
				<div className="relative flex-1 overflow-hidden">
					{tabs.map((tab) => (
						<div
							key={tab.id}
							className={`absolute inset-0 ${tab.id === activeTabId ? "visible" : "invisible"}`}
						>
							<Terminal id={tab.id} />
						</div>
					))}
				</div>
			</main>
		</div>
	);
}
