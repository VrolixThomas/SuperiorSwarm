import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAlert } from "../../shared/agent-events";
import { useAgentAlertStore } from "../stores/agent-alert-store";
import { usePaneStore } from "../stores/pane-store";
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
	projectId: string;
	projectName: string;
	projectRepoPath: string;
	isInActiveProject: boolean;
}

/**
 * Micro swarm icon for agent alert indicators.
 * Renders a simplified version of the Superior Swarm brand mark at sidebar scale.
 * - active: animated breathing dots (orange/amber)
 * - needs-input: animated breathing dots (yellow tint, faster)
 * - task-complete: static dots (green tint)
 */
export function SwarmIndicator({ alert, className }: { alert: AgentAlert; className?: string }) {
	const animated = alert !== "task-complete";
	const dur = alert === "needs-input" ? "2s" : "3.2s";

	// Color palette per state
	const core = alert === "task-complete" ? "var(--term-green)" : "#fff";
	const c1 =
		alert === "task-complete" ? "#69db7c" : alert === "needs-input" ? "#ffd43b" : "#f0a060";
	const c2 =
		alert === "task-complete" ? "#51cf66" : alert === "needs-input" ? "#fab005" : "#e07030";
	const c3 =
		alert === "task-complete" ? "#40c057" : alert === "needs-input" ? "#f59f00" : "#c05828";

	return (
		<svg
			width="22"
			height="22"
			viewBox="0 0 100 100"
			className={`shrink-0 ${className ?? ""}`}
			aria-label={
				alert === "active"
					? "Agent working"
					: alert === "needs-input"
						? "Agent needs input"
						: "Agent complete"
			}
		>
			{/* Orbiting dots */}
			<g style={{ transformOrigin: "50px 50px" }}>
				{animated && (
					<animateTransform
						attributeName="transform"
						type="scale"
						values="1;0.5;1"
						keyTimes="0;0.45;1"
						dur={dur}
						repeatCount="indefinite"
						calcMode="spline"
						keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
					/>
				)}
				<circle cx="26" cy="36" r="7" fill={c3} opacity={animated ? undefined : 0.8}>
					{animated && (
						<animate
							attributeName="opacity"
							values="0.8;0.15;0.8"
							keyTimes="0;0.45;1"
							dur={dur}
							repeatCount="indefinite"
							calcMode="spline"
							keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
						/>
					)}
				</circle>
				<circle cx="72" cy="30" r="6" fill={c2} opacity={animated ? undefined : 0.7}>
					{animated && (
						<animate
							attributeName="opacity"
							values="0.7;0.1;0.7"
							keyTimes="0;0.45;1"
							dur={dur}
							repeatCount="indefinite"
							calcMode="spline"
							keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
						/>
					)}
				</circle>
				<circle cx="78" cy="62" r="7" fill={c1} opacity={animated ? undefined : 0.75}>
					{animated && (
						<animate
							attributeName="opacity"
							values="0.75;0.1;0.75"
							keyTimes="0;0.45;1"
							dur={dur}
							repeatCount="indefinite"
							calcMode="spline"
							keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
						/>
					)}
				</circle>
				<circle cx="35" cy="75" r="6" fill={c2} opacity={animated ? undefined : 0.65}>
					{animated && (
						<animate
							attributeName="opacity"
							values="0.65;0.1;0.65"
							keyTimes="0;0.45;1"
							dur={dur}
							repeatCount="indefinite"
							calcMode="spline"
							keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
						/>
					)}
				</circle>
			</g>
			{/* Inner ring */}
			<g style={{ transformOrigin: "50px 50px" }}>
				{animated && (
					<animateTransform
						attributeName="transform"
						type="scale"
						values="1;0.7;1"
						keyTimes="0;0.45;1"
						dur={dur}
						repeatCount="indefinite"
						calcMode="spline"
						keySplines="0.4 0 0.6 1;0.4 0 0.6 1"
					/>
				)}
				<circle cx="38" cy="40" r="9" fill={c1} opacity={0.9} />
				<circle cx="65" cy="44" r="8" fill={c2} opacity={0.85} />
				<circle cx="48" cy="67" r="7" fill={c1} opacity={0.8} />
			</g>
			{/* Core */}
			<circle cx="50" cy="50" r="10" fill={core} opacity={0.95} />
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

export function WorkspaceItem({
	workspace,
	projectId,
	projectName,
	projectRepoPath,
	isInActiveProject,
}: WorkspaceItemProps) {
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	const utils = trpc.useUtils();
	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const deleteWorkspace = trpc.workspaces.delete.useMutation({
		onMutate: async ({ id }) => {
			await utils.workspaces.listByProject.cancel({ projectId });
			const previous = utils.workspaces.listByProject.getData({ projectId });
			utils.workspaces.listByProject.setData({ projectId }, (old) =>
				old?.filter((ws) => ws.id !== id)
			);
			return { previous };
		},
		onError: (_err, _vars, context) => {
			if (context?.previous) {
				utils.workspaces.listByProject.setData({ projectId }, context.previous);
			}
			window.alert(`Failed to delete worktree: ${_err.message}`);
		},
		onSuccess: () => {
			// Clean up Zustand state after server confirms deletion
			const paneStore = usePaneStore.getState();
			paneStore.clearLayout(workspace.id);
			useTabStore.getState().cleanupWorkspace(workspace.id);
		},
		onSettled: () => {
			utils.workspaces.listByProject.invalidate({ projectId });
		},
	});
	const deleteWorkspaceRef = useRef(deleteWorkspace.mutate);
	deleteWorkspaceRef.current = deleteWorkspace.mutate;

	const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);
	const alert = useAgentAlertStore((s) => s.alerts[workspace.id]);

	const solveSessionsQuery = trpc.commentSolver.getSolveSessions.useQuery(
		{ workspaceId: workspace.id },
		{ enabled: workspace.prProvider != null, staleTime: 30_000 }
	);

	const sessions = solveSessionsQuery.data ?? [];
	const hasReadySessions = sessions.some((s) => s.status === "ready");
	const hasSolveInProgress = sessions.some(
		(s) => s.status === "queued" || s.status === "in_progress"
	);

	const handleClick = useCallback(() => {
		useAgentAlertStore.getState().clearAlert(workspace.id);
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

	const handleDelete = useCallback(async () => {
		const confirmed = window.confirm(
			`Delete worktree "${workspace.name}"? This will remove the worktree directory.`
		);
		if (confirmed) {
			// Await terminal disposal so daemon processes release the worktree cwd
			const wsTabs = useTabStore.getState().getTabsByWorkspace(workspace.id);
			await Promise.all(
				wsTabs
					.filter((tab) => tab.kind === "terminal")
					.map((tab) => window.electron.terminal.dispose(tab.id))
			);

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
					"flex w-full items-center gap-2 border-none pr-3 py-[7px] cursor-pointer",
					"transition-all duration-[120ms] text-left",
					isActive
						? "rounded-r-[6px] rounded-l-none bg-[var(--bg-elevated)]"
						: "rounded-[6px] bg-transparent",
					isActive && isInActiveProject
						? "pl-[20px] -ml-[2px] border-l-2 border-[var(--accent)]"
						: "pl-[22px]",
					isActive ? "hover:bg-[var(--bg-overlay)]" : "hover:bg-[var(--bg-elevated)]",
				].join(" ")}
			>
				<div className="flex-1 min-w-0">
					<span
						className={[
							"truncate text-[13px] block",
							isActive
								? "text-[var(--text)]"
								: isInActiveProject
									? "text-[var(--text-secondary)]"
									: "text-[var(--text-tertiary)]",
						].join(" ")}
					>
						{workspace.name}
					</span>
					{hasSolveInProgress && (
						<span className="flex items-center gap-1 mt-0.5">
							<svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
								<path
									d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z"
									stroke="var(--text-quaternary)"
									strokeWidth="1.3"
								/>
							</svg>
							<span className="text-[10px] text-[var(--text-quaternary)]">solving comments</span>
						</span>
					)}
					{!hasSolveInProgress && hasReadySessions && (
						<span className="flex items-center gap-1 mt-0.5">
							<svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
								<path
									d="M5 8l2 2 4-4"
									stroke="var(--term-green)"
									strokeWidth="1.5"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
							<span className="text-[10px] text-[#3e3e46]">comments resolved</span>
						</span>
					)}
				</div>
				{alert && <SwarmIndicator alert={alert} className="ml-auto" />}
			</button>

			{contextMenu && (
				<WorkspaceContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onDelete={handleDelete}
				/>
			)}
		</div>
	);
}
