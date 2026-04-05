import { useEffect } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

export function resolveQuickActionCwd(cwd: string | null, repoPath: string): string {
	if (!cwd) return repoPath;
	return cwd.startsWith("/") ? cwd : `${repoPath}/${cwd}`;
}

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

	useEffect(() => {
		window.electron.quickActions.syncShortcuts(projectId);
	}, [projectId, actionsQuery.data]);

	function handleRun(command: string, label: string, cwd: string | null) {
		const resolvedCwd = resolveQuickActionCwd(cwd, repoPath);
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
				className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		);
	}

	return (
		<>
			<span className="shrink-0 text-[var(--text-quaternary)]">|</span>
			<div className="flex min-w-0 items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
				{actions.map((action) => (
					<button
						key={action.id}
						type="button"
						onClick={() => handleRun(action.command, action.label, action.cwd)}
						onContextMenu={(e) => {
							e.preventDefault();
							window.dispatchEvent(
								new CustomEvent("quick-action-context", {
									detail: { action, x: e.clientX, y: e.clientY, allActions: actions },
								})
							);
						}}
						className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-tertiary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text)]"
					>
						{action.label}
					</button>
				))}
			</div>
			<button
				type="button"
				onClick={onAddClick}
				className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[12px] text-[var(--text-quaternary)] transition-colors duration-[var(--transition-fast)] hover:text-[var(--text-secondary)]"
			>
				+
			</button>
		</>
	);
}
