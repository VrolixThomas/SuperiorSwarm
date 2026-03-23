import { useCallback, useEffect, useRef, useState } from "react";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface WorkspaceData {
	id: string;
	type: "branch" | "worktree";
	name: string;
	terminalId: string | null;
	worktreePath: string | null;
	prProvider: string | null;
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
	onSolveComments,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onDelete: () => void;
	onSolveComments?: () => void;
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
			{onSolveComments && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--accent)]"
					onClick={onSolveComments}
					onKeyDown={(e) => {
						if (e.key === "Enter") onSolveComments();
					}}
				>
					Solve Comments
				</div>
			)}
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
		onError: (err) => {
			window.alert(`Failed to delete worktree: ${err.message}`);
		},
	});
	const deleteWorkspaceRef = useRef(deleteWorkspace.mutate);
	deleteWorkspaceRef.current = deleteWorkspace.mutate;

	const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);

	const triggerSolve = trpc.commentSolver.triggerSolve.useMutation({
		onSuccess: (launch) => {
			utils.workspaces.listByProject.invalidate();
			utils.commentSolver.getSolveSessions.invalidate();
			// Open the workspace and switch to solve panel
			const cwd = launch.worktreePath;
			const store = useTabStore.getState();
			store.setActiveWorkspace(workspace.id, cwd);
			// Create terminal tab for the AI solver
			const tabId = store.addTerminalTab(workspace.id, cwd, "AI Solver");
			window.electron.terminal.create(tabId, cwd).then(() => {
				window.electron.terminal.write(tabId, `bash '${launch.launchScript}'\n`);
			});
		},
		onError: (err) => {
			window.alert(`Failed to solve comments: ${err.message}`);
		},
	});

	const solveSessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId: workspace.id },
		{ enabled: workspace.prProvider != null, staleTime: 30_000 }
	);

	const sessions = solveSessionsQuery.data ?? [];
	const hasReadySessions = sessions.some((s) => s.status === "ready");
	const hasUnresolvedComments = sessions.some(
		(s) => s.status === "queued" || s.status === "in_progress"
	);

	const handleClick = useCallback(() => {
		const cwd =
			workspace.type === "worktree" && workspace.worktreePath
				? workspace.worktreePath
				: projectRepoPath;

		const store = useTabStore.getState();
		store.setActiveWorkspace(workspace.id, cwd);

		const existing = store.getTabsByWorkspace(workspace.id);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = `${projectName}: ${workspace.name}`;
			const tabId = store.addTerminalTab(workspace.id, cwd, title);

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

	const handleSolveComments = useCallback(() => {
		setContextMenu(null);
		triggerSolve.mutate({ workspaceId: workspace.id });
	}, [workspace.id, triggerSolve]);

	const handleDelete = useCallback(() => {
		const confirmed = window.confirm(
			`Delete worktree "${workspace.name}"? This will remove the worktree directory.`
		);
		if (confirmed) {
			const store = useTabStore.getState();
			const wsTabs = store.getTabsByWorkspace(workspace.id);
			for (const tab of wsTabs) {
				if (tab.kind === "terminal") {
					window.electron.terminal.dispose(tab.id);
				}
				store.removeTab(tab.id);
			}
			if (store.activeWorkspaceId === workspace.id) {
				store.setActiveWorkspace("", "");
			}
			deleteWorkspaceRef.current({ id: workspace.id, force: true });
		}
		setContextMenu(null);
	}, [workspace.id, workspace.name]);

	return (
		<div className="relative">
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
				{hasReadySessions && (
					<span
						className="ml-auto shrink-0 size-[6px] rounded-full bg-[#0a84ff]"
						title="Fixes ready for review"
					/>
				)}
				{!hasReadySessions && hasUnresolvedComments && (
					<span
						className="ml-auto shrink-0 size-[6px] rounded-full bg-[var(--accent)]"
						title="Unresolved comments"
					/>
				)}
			</button>

			{contextMenu && (
				<WorkspaceContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onDelete={handleDelete}
					onSolveComments={workspace.type === "worktree" ? handleSolveComments : undefined}
				/>
			)}
		</div>
	);
}
