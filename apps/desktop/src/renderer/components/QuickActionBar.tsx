import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface QuickActionBarProps {
	projectId: string;
	repoPath: string;
	workspaceId: string;
	onAddClick: () => void;
}

export function QuickActionBar({
	projectId,
	repoPath,
	workspaceId,
	onAddClick,
}: QuickActionBarProps) {
	const actionsQuery = trpc.quickActions.list.useQuery({ projectId });
	const addTerminalTab = useTabStore((s) => s.addTerminalTab);

	function handleRun(command: string, label: string, cwd: string | null) {
		const resolvedCwd = cwd ? `${repoPath}/${cwd}` : repoPath;
		const tabId = addTerminalTab(workspaceId, resolvedCwd, label);
		setTimeout(() => {
			window.electron.terminal.write(tabId, `${command}\n`);
		}, 300);
	}

	const actions = actionsQuery.data ?? [];

	if (actions.length === 0) {
		return (
			<button
				type="button"
				onClick={onAddClick}
				className="rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		);
	}

	return (
		<>
			<span className="text-[var(--text-quaternary)]">|</span>
			{actions.map((action) => (
				<button
					key={action.id}
					type="button"
					onClick={() => handleRun(action.command, action.label, action.cwd)}
					onContextMenu={(e) => {
						e.preventDefault();
						window.dispatchEvent(
							new CustomEvent("quick-action-context", {
								detail: { action, x: e.clientX, y: e.clientY },
							})
						);
					}}
					className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-tertiary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text)]"
				>
					{action.label}
				</button>
			))}
			<button
				type="button"
				onClick={onAddClick}
				className="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		</>
	);
}
