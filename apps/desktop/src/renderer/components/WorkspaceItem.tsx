import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAlert } from "../../shared/agent-events";
import { useCrossRepoOrchestratorColor } from "../hooks/useCrossRepoOrchestratorColor";
import { useAgentAlertStore } from "../stores/agent-alert-store";
import { usePaneStore } from "../stores/pane-store";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { splitBranchPrefix } from "../utils/branch-name";

interface WorkspaceData {
	id: string;
	type: "branch" | "worktree";
	name: string;
	terminalId: string | null;
	worktreePath: string | null;
	prProvider: string | null;
	currentPhase?: string | null;
	statusText?: string | null;
	needs?: string | null;
	isOrchestrator?: boolean | null;
	cliPreset?: string | null;
}

interface WorkspaceItemProps {
	workspace: WorkspaceData;
	projectId: string;
	projectName: string;
	projectRepoPath: string;
	isInActiveProject: boolean;
	indentLevel?: 0 | 1;
	crossRepoOrchestrator?: { id: string; name: string } | null;
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
	onSetOrchestrator,
	onUnsetOrchestrator,
	isOrchestrator,
	orchestrators,
	onAttachTo,
	onDetach,
	onCreateOrchestrator,
	canAttach,
	canDetach,
	xros,
	onAttachToXro,
}: {
	position: { x: number; y: number };
	onClose: () => void;
	onDelete: () => void;
	onSetOrchestrator?: () => void;
	onUnsetOrchestrator?: () => void;
	isOrchestrator?: boolean | null;
	orchestrators: Array<{ id: string; name: string }>;
	onAttachTo?: (orchestratorId: string) => void;
	onDetach?: () => void;
	onCreateOrchestrator?: () => void;
	canAttach: boolean;
	canDetach: boolean;
	xros: Array<{ id: string; name: string }>;
	onAttachToXro?: (xroId: string) => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [adjusted, setAdjusted] = useState(position);
	const [attachOpen, setAttachOpen] = useState(false);

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
			{onSetOrchestrator && !isOrchestrator && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
					onClick={onSetOrchestrator}
					onKeyDown={(e) => {
						if (e.key === "Enter") onSetOrchestrator();
					}}
				>
					Set as orchestrator
				</div>
			)}
			{onUnsetOrchestrator && isOrchestrator && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
					onClick={onUnsetOrchestrator}
					onKeyDown={(e) => {
						if (e.key === "Enter") onUnsetOrchestrator();
					}}
				>
					Unset orchestrator
				</div>
			)}
			{canAttach && (
				<div
					className="relative"
					onMouseEnter={() => setAttachOpen(true)}
					onMouseLeave={() => setAttachOpen(false)}
				>
					<div
						role="menuitem"
						tabIndex={0}
						className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)] flex items-center justify-between"
					>
						<span>Attach to</span>
						<span className="text-[var(--text-quaternary)]">▸</span>
					</div>
					{attachOpen && (
						<div className="absolute left-full top-0 ml-1 min-w-[180px] rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] py-1 shadow-[var(--shadow-md)]">
							{orchestrators.length === 0 && (
								<div
									role="menuitem"
									tabIndex={0}
									className="px-3 py-1.5 text-[12px] cursor-pointer hover:bg-[var(--bg-overlay)] text-[var(--text-tertiary)]"
									onClick={onCreateOrchestrator}
								>
									No orchestrators in this project. Create one →
								</div>
							)}
							{orchestrators.map((o) => (
								<div
									key={o.id}
									role="menuitem"
									tabIndex={0}
									className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] text-[var(--text)]"
									onClick={() => onAttachTo?.(o.id)}
								>
									{o.name}
								</div>
							))}
						</div>
					)}
				</div>
			)}
			{canDetach && onDetach && (
				<div
					role="menuitem"
					tabIndex={0}
					className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
					onClick={onDetach}
				>
					Detach from orchestrator
				</div>
			)}
			{xros.length > 0 && onAttachToXro && (
				<>
					<div className="border-t border-[var(--border)] my-1" />
					<div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-quaternary)]">
						Attach to cross-repo orchestrator
					</div>
					{xros.map((xro) => (
						<div
							key={xro.id}
							role="menuitem"
							tabIndex={0}
							className="px-3 py-1.5 text-[13px] cursor-pointer hover:bg-[var(--bg-overlay)] transition-all duration-[120ms] text-[var(--text)]"
							onClick={() => onAttachToXro(xro.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter") onAttachToXro(xro.id);
							}}
						>
							{xro.name}
						</div>
					))}
				</>
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

export function WorkspaceItem({
	workspace,
	projectId,
	projectName,
	projectRepoPath,
	isInActiveProject,
	indentLevel = 0,
	crossRepoOrchestrator = null,
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
			const previousList = utils.workspaces.listByProject.getData({ projectId });
			const paneStore = usePaneStore.getState();
			const tabStore = useTabStore.getState();
			const previousLayout = paneStore.getLayout(id);
			const previousMetadata = tabStore.workspaceMetadata[id];

			utils.workspaces.listByProject.setData({ projectId }, (old) => {
				if (!old) return old;
				return {
					orchestrators: old.orchestrators
						.filter((o) => o.workspace.id !== id)
						.map((o) => ({
							...o,
							children: o.children.filter((c) => c.id !== id),
						})),
					loose: old.loose.filter((w) => w.id !== id),
				};
			});
			paneStore.clearLayout(id);
			tabStore.cleanupWorkspace(id);

			return { previousList, previousLayout, previousMetadata };
		},
		// On error we restore the list, pane layout, and workspace metadata.
		// `cleanupWorkspace` also clears active segment / right panel / PR-solve
		// session stores; those are not restored — user must reselect. Acceptable
		// because `force: true` failures are rare and the user can click again.
		onError: (err, { id }, context) => {
			if (context?.previousList) {
				utils.workspaces.listByProject.setData({ projectId }, context.previousList);
			}
			if (context?.previousLayout) {
				usePaneStore.getState().hydrateLayout(id, context.previousLayout);
			}
			if (context?.previousMetadata) {
				useTabStore.getState().setWorkspaceMetadata(id, context.previousMetadata);
			}
		},
		onSettled: () => {
			utils.workspaces.listByProject.invalidate({ projectId });
		},
	});
	const deleteWorkspaceRef = useRef(deleteWorkspace.mutate);
	deleteWorkspaceRef.current = deleteWorkspace.mutate;

	const setOrchestrator = trpc.workspaces.setOrchestrator.useMutation({
		onSuccess: () => {
			utils.workspaces.listByProject.invalidate({ projectId });
		},
	});

	const handleSetOrchestrator = useCallback(() => {
		setOrchestrator.mutate({ projectId, workspaceId: workspace.id });
		setContextMenu(null);
	}, [workspace.id, projectId, setOrchestrator]);

	const unsetOrchestrator = trpc.workspaces.unsetOrchestrator.useMutation({
		onSuccess: () => {
			utils.workspaces.listByProject.invalidate({ projectId });
		},
	});

	const treeQueryForMenu = trpc.workspaces.listByProject.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);
	const orchestratorsInProject = (treeQueryForMenu.data?.orchestrators ?? []).map((o) => ({
		id: o.workspace.id,
		name: o.workspace.name,
	}));
	const isChildOfOrchestrator = (treeQueryForMenu.data?.orchestrators ?? []).some((o) =>
		o.children.some((c) => c.id === workspace.id)
	);

	const attachMut = trpc.workspaces.attachToOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});
	const detachMut = trpc.workspaces.detachFromOrchestrator.useMutation({
		onSuccess: () => utils.workspaces.listByProject.invalidate({ projectId }),
	});

	const xrosQuery = trpc.crossRepoOrchestrators.list.useQuery(undefined, {
		staleTime: 60_000,
	});
	const xros = xrosQuery.data ?? [];
	const allXroIds = xros.map((x) => x.id);
	const xroColor = useCrossRepoOrchestratorColor(crossRepoOrchestrator?.id ?? "", allXroIds);
	const attachXroMut = trpc.crossRepoOrchestrators.attachMember.useMutation({
		onError: (err) => console.warn("[xro] attach failed:", err.message),
	});

	const handleUnsetOrchestrator = useCallback(() => {
		unsetOrchestrator.mutate({ projectId, workspaceId: workspace.id });
		setContextMenu(null);
	}, [workspace.id, projectId, unsetOrchestrator]);

	const isActive = useTabStore((s) => s.activeWorkspaceId === workspace.id);
	const { prefix: branchPrefix, rest: branchRest } = splitBranchPrefix(workspace.name);
	const showStatusIndicators = indentLevel === 0;
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

	const handleDelete = useCallback(() => {
		const confirmed = window.confirm(
			`Delete worktree "${workspace.name}"? This will remove the worktree directory.`
		);
		if (confirmed) {
			// Fire-and-forget; backend re-disposes PTYs as a safety net.
			const wsTabs = useTabStore.getState().getTabsByWorkspace(workspace.id);
			for (const tab of wsTabs) {
				if (tab.kind === "terminal") {
					window.electron.terminal.dispose(tab.id).catch(() => {});
				}
			}
			deleteWorkspaceRef.current({ id: workspace.id, force: true });
		}
		setContextMenu(null);
	}, [workspace.id, workspace.name]);

	return (
		<div className="group relative">
			<button
				type="button"
				onClick={handleClick}
				onContextMenu={(e) => {
					if (workspace.type === "worktree") {
						e.preventDefault();
						setContextMenu({ x: e.clientX, y: e.clientY });
					}
				}}
				onKeyDown={(e) => {
					const mod = e.metaKey || e.ctrlKey;
					if (mod && e.shiftKey && (e.key === "a" || e.key === "A")) {
						e.preventDefault();
						if (!workspace.isOrchestrator && indentLevel === 0 && workspace.type === "worktree") {
							const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
							setContextMenu({ x: rect.right - 200, y: rect.bottom });
						}
					}
					if (mod && e.shiftKey && (e.key === "d" || e.key === "D")) {
						e.preventDefault();
						if (isChildOfOrchestrator) {
							detachMut.mutate({ workspaceId: workspace.id });
						}
					}
				}}
				className={[
					"relative flex w-full items-center gap-2 border-none",
					indentLevel === 1 ? "pl-[36px] pr-3 py-[7px]" : "pl-[22px] pr-3 py-[7px]",
					"cursor-pointer transition-all duration-[120ms] text-left rounded-[6px]",
					isActive
						? "bg-[var(--accent-subtle)] hover:bg-[var(--accent-subtle)]"
						: "bg-transparent hover:bg-[var(--bg-elevated)]",
				].join(" ")}
			>
				<div className="flex-1 min-w-0">
					<span
						className={[
							"truncate text-[13px] block",
							isActive
								? "font-medium text-[var(--text)]"
								: isInActiveProject
									? "text-[var(--text-secondary)]"
									: "text-[var(--text-tertiary)]",
						].join(" ")}
					>
						{branchPrefix && (
							<span
								className={
									isActive ? "text-[var(--accent-hover)]" : "text-[var(--text-quaternary)]"
								}
							>
								{branchPrefix}
							</span>
						)}
						{branchRest}
					</span>
					{crossRepoOrchestrator && (
						<span
							className="inline-flex shrink-0 items-center gap-[4px] rounded-[8px] px-[5px] py-[1px] text-[9.5px] font-semibold"
							style={{
								color: `var(--orch-${xroColor})`,
								background: `var(--orch-${xroColor}-bg)`,
							}}
							title={`Member of ${crossRepoOrchestrator.name}`}
						>
							<span
								className="h-[6px] w-[6px] rounded-full"
								style={{ background: `var(--orch-${xroColor})` }}
							/>
							{crossRepoOrchestrator.name}
						</span>
					)}
					{workspace.isOrchestrator && (
						<span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--accent)]">
							Orchestrator
						</span>
					)}
					{workspace.statusText && (
						<span className="block text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
							{workspace.statusText}
						</span>
					)}
					{workspace.currentPhase === "blocked" && workspace.needs && (
						<span className="block text-[11px] text-[var(--text-tertiary)] italic truncate mt-0.5">
							needs: {workspace.needs}
						</span>
					)}
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
							<span className="text-[10px] text-[var(--text-quaternary)]">comments resolved</span>
						</span>
					)}
				</div>
				{showStatusIndicators && workspace.currentPhase === "working" && (
					<span
						className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
						title="working"
					/>
				)}
				{showStatusIndicators && workspace.currentPhase === "blocked" && (
					<span
						className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-[var(--term-yellow)]"
						title="blocked"
					/>
				)}
				{showStatusIndicators && workspace.currentPhase === "done" && (
					<span
						className="ml-auto inline-block h-1.5 w-1.5 rounded-full bg-[var(--term-green)]"
						title="done"
					/>
				)}
				{showStatusIndicators && alert && <SwarmIndicator alert={alert} className="ml-auto" />}
			</button>

			{indentLevel === 0 && !workspace.isOrchestrator && workspace.type === "worktree" && (
				<button
					type="button"
					aria-label="Promote to orchestrator"
					title="Promote to orchestrator"
					onClick={(e) => {
						e.stopPropagation();
						handleSetOrchestrator();
					}}
					className="absolute right-7 top-1/2 -translate-y-1/2 h-5 w-5 flex items-center justify-center rounded text-[14px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] opacity-0 group-hover:opacity-55 focus:opacity-100 transition-opacity duration-[120ms]"
				>
					↥
				</button>
			)}

			{contextMenu && (
				<WorkspaceContextMenu
					position={contextMenu}
					onClose={() => setContextMenu(null)}
					onDelete={handleDelete}
					onSetOrchestrator={workspace.type === "worktree" ? handleSetOrchestrator : undefined}
					onUnsetOrchestrator={workspace.type === "worktree" ? handleUnsetOrchestrator : undefined}
					isOrchestrator={workspace.isOrchestrator}
					orchestrators={orchestratorsInProject}
					onAttachTo={(orchId) => {
						attachMut.mutate({ orchestratorId: orchId, workspaceId: workspace.id });
						setContextMenu(null);
					}}
					onDetach={() => {
						detachMut.mutate({ workspaceId: workspace.id });
						setContextMenu(null);
					}}
					onCreateOrchestrator={() => {
						useProjectStore.getState().openCreateWorktreeModal(projectId, { asOrchestrator: true });
						setContextMenu(null);
					}}
					canAttach={
						!workspace.isOrchestrator && indentLevel === 0 && workspace.type === "worktree"
					}
					canDetach={isChildOfOrchestrator}
					xros={xros}
					onAttachToXro={(xroId) => {
						attachXroMut.mutate({ id: xroId, workspaceId: workspace.id });
						setContextMenu(null);
					}}
				/>
			)}
		</div>
	);
}
