import { useCallback, useEffect, useRef, useState } from "react";
import { useTerminalStore } from "../stores/terminal";
import { trpc } from "../trpc/client";

interface WorkspaceData {
	id: string;
	type: "branch" | "worktree";
	name: string;
	terminalId: string | null;
	worktreePath: string | null;
}

interface WorkspaceItemProps {
	workspace: WorkspaceData;
	projectName: string;
	projectRepoPath: string;
}

function BranchIcon({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			width="12"
			height="12"
			viewBox="0 0 16 16"
			fill="none"
			className={className}
		>
			<circle cx="5" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.3" />
			<circle cx="5" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.3" />
			<circle cx="11" cy="7" r="1.5" stroke="currentColor" strokeWidth="1.3" />
			<path
				d="M5 5.5v5M5 7c0-1 .5-1.5 1.5-1.5H9.5"
				stroke="currentColor"
				strokeWidth="1.3"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function WorkspaceContextMenu({
	position,
	onClose,
	onDelete,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onDelete: () => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);

	useEffect(() => {
		if (!menuRef.current) return;
		const rect = menuRef.current.getBoundingClientRect();
		let { x, y } = position;

		if (x + rect.width > window.innerWidth) {
			x = window.innerWidth - rect.width - 8;
		}
		if (y + rect.height > window.innerHeight) {
			y = window.innerHeight - rect.height - 8;
		}

		if (x !== position.x || y !== position.y) {
			setAdjusted({ x, y });
		}
	}, [position]);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [onClose]);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	return (
		<div
			ref={menuRef}
			className="fixed z-50 min-w-[160px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]"
			style={{ left: adjusted.x, top: adjusted.y }}
		>
			<div
				role="menuitem"
				tabIndex={0}
				className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--term-red)]"
				onClick={onDelete}
				onKeyDown={(e) => {
					if (e.key === "Enter") onDelete();
				}}
			>
				Delete Worktree
			</div>
		</div>
	);
}

export function WorkspaceItem({ workspace, projectName, projectRepoPath }: WorkspaceItemProps) {
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	const utils = trpc.useUtils();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const deleteWorkspace = trpc.workspaces.delete.useMutation({
		onSuccess: () => {
			utils.workspaces.listByProject.invalidate();
		},
	});
	const deleteWorkspaceRef = useRef(deleteWorkspace.mutate);
	deleteWorkspaceRef.current = deleteWorkspace.mutate;

	const isActive = useTerminalStore((s) => s.activeWorkspaceId === workspace.id);

	const handleClick = useCallback(() => {
		const cwd =
			workspace.type === "worktree" && workspace.worktreePath
				? workspace.worktreePath
				: projectRepoPath;

		const store = useTerminalStore.getState();
		store.setActiveWorkspace(workspace.id, cwd);

		// Auto-create first terminal if none exist for this workspace.
		// PTY creation is handled by the Terminal component's useEffect — only
		// add the tab to the store here; mounting <Terminal> spawns the PTY.
		const existing = store.getTabsByWorkspace(workspace.id);
		if (existing.length === 0) {
			const title = `${projectName}: ${workspace.name}`;
			const tabId = store.addTab(workspace.id, cwd, title);

			attachTerminalRef.current({
				workspaceId: workspace.id,
				terminalId: tabId,
			});
		}
	}, [
		workspace.id,
		workspace.type,
		workspace.worktreePath,
		workspace.name,
		projectName,
		projectRepoPath,
	]);

	const handleDelete = useCallback(() => {
		const confirmed = window.confirm(
			`Delete worktree "${workspace.name}"? This will remove the worktree directory.`
		);
		if (confirmed) {
			const store = useTerminalStore.getState();
			const wsTabs = store.getTabsByWorkspace(workspace.id);
			for (const tab of wsTabs) {
				window.electron.terminal.dispose(tab.id);
				store.removeTab(tab.id);
			}
			if (store.activeWorkspaceId === workspace.id) {
				store.setActiveWorkspace("", "");
			}
			deleteWorkspaceRef.current({ id: workspace.id });
		}
		setContextMenu(null);
	}, [workspace.id, workspace.name]);

	return (
		<>
			<button
				type="button"
				onClick={handleClick}
				onContextMenu={(e) => {
					if (workspace.type === "worktree") {
						e.preventDefault();
						setContextMenu({ x: e.clientX, y: e.clientY });
					}
				}}
				className={[
					"flex w-full items-center gap-2 border-none pl-7 pr-3 py-1 rounded-[6px] cursor-pointer",
					"transition-all duration-[120ms] text-left",
					isActive
						? "bg-[var(--bg-elevated)] text-[var(--text)]"
						: "bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
				].join(" ")}
			>
				<BranchIcon className="shrink-0 opacity-50" />
				<span className="truncate text-[13px]">{workspace.name}</span>
			</button>

			{contextMenu && (
				<WorkspaceContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onDelete={handleDelete}
				/>
			)}
		</>
	);
}
