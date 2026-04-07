import { useEffect, useRef, useState } from "react";
import type { Project } from "../../main/db/schema";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { WorkspaceItem } from "./WorkspaceItem";

interface ProjectItemProps {
	project: Project;
	isExpanded: boolean;
	onToggle: () => void;
	activeWorkspaceId: string;
}

export function ProjectItem({
	project,
	isExpanded,
	onToggle,
	activeWorkspaceId,
}: ProjectItemProps) {
	const isCloning = project.status === "cloning";
	const isReady = project.status === "ready";

	// Poll clone progress when cloning
	const { data: progress } = trpc.projects.cloneProgress.useQuery(
		{ id: project.id },
		{ enabled: isCloning, refetchInterval: 1000 }
	);

	// Poll project status to detect when clone completes.
	// IMPORTANT: do NOT put `invalidate()` in a `select` callback — TanStack Query v5
	// re-runs `select` on every render when the function reference changes (which it
	// does for inline arrows), creating an infinite invalidate→refetch→render loop.
	// (See queryObserver.cjs:253-267 — the memoization check requires
	// `options.select === _selectFn`, which fails for inline arrows.)
	// Instead, observe the polled status in a `useEffect` and invalidate once per
	// cloning episode.
	const utils = trpc.useUtils();
	const projectStatusQuery = trpc.projects.getById.useQuery(
		{ id: project.id },
		{
			enabled: isCloning,
			refetchInterval: 2000,
		}
	);

	// Fire `projects.list.invalidate()` exactly once per cloning episode, the
	// first time the polled status reads as non-cloning. The ref resets whenever
	// `isCloning` flips back to false (i.e. the parent has picked up the new
	// status), so a future re-clone of the same project still works.
	//
	// We deliberately do NOT require observing a `cloning → ready` transition:
	// the cache for `getById({id})` may already be warm with `status="ready"`
	// from `CreateWorktreeModal` or `SharedFilesPanel`, in which case the very
	// first read after this `ProjectItem` enters cloning mode will already be
	// non-cloning. We still want to fire once in that case so the parent's
	// `projects.list` refetches and the sidebar transitions out of "Cloning…".
	const hasInvalidatedRef = useRef(false);
	useEffect(() => {
		if (!isCloning) {
			hasInvalidatedRef.current = false;
			return;
		}
		const status = projectStatusQuery.data?.status;
		if (status && status !== "cloning" && !hasInvalidatedRef.current) {
			hasInvalidatedRef.current = true;
			utils.projects.list.invalidate();
		}
	}, [isCloning, projectStatusQuery.data?.status, utils]);

	// Fetch workspaces when expanded and project is ready
	const { data: workspacesList } = trpc.workspaces.listByProject.useQuery(
		{ projectId: project.id },
		{ enabled: isExpanded && isReady, refetchInterval: 60_000 }
	);

	const openCreateWorktreeModal = useProjectStore((s) => s.openCreateWorktreeModal);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
	} | null>(null);

	// Determine if this project contains the active workspace
	const visibleWorkspaces = workspacesList?.filter((ws) => ws.type !== "review") ?? [];
	const isActiveProject = visibleWorkspaces.some((ws) => ws.id === activeWorkspaceId);

	return (
		<div>
			{/* Project group container — gets accent stripe when active */}
			<div
				style={
					isActiveProject && isExpanded
						? {
								borderLeft: "2px solid rgba(10, 132, 255, 0.19)",
								borderRadius: 2,
							}
						: undefined
				}
			>
				{/* Project header */}
				<button
					type="button"
					onClick={isReady ? onToggle : undefined}
					onContextMenu={(e) => {
						e.preventDefault();
						setContextMenu({ x: e.clientX, y: e.clientY });
					}}
					className={[
						"flex w-full items-center gap-2 border-none px-3 py-1.5 cursor-pointer",
						"transition-all duration-[120ms] text-left",
						isActiveProject && isExpanded ? "rounded-r-[8px] rounded-l-none" : "rounded-[8px]",
						isActiveProject ? "text-[var(--text)]" : "text-[#505058]",
						isActiveProject && isExpanded
							? "bg-gradient-to-br from-[#1a1a24] to-[#16161e]"
							: "bg-transparent hover:bg-[var(--bg-elevated)]",
					].join(" ")}
				>
					{/* Name and clone status */}
					<div className="min-w-0 flex-1">
						<div
							className={["truncate text-[13px] font-semibold", isCloning ? "opacity-60" : ""].join(
								" "
							)}
						>
							{project.name}
						</div>
						{isCloning && (
							<div className="text-[11px] text-[var(--text-quaternary)]">
								{progress ? `${progress.stage}... ${progress.progress}%` : "Cloning..."}
							</div>
						)}
					</div>

					{/* + button (create worktree) */}
					{isReady && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openCreateWorktreeModal(project.id);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.stopPropagation();
									openCreateWorktreeModal(project.id);
								}
							}}
							className={[
								"flex h-5 w-5 shrink-0 items-center justify-center rounded text-[14px]",
								"transition-colors duration-[120ms]",
								isActiveProject
									? "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
									: "text-[#3a3a42] hover:text-[#505058]",
							].join(" ")}
							title="New Worktree"
						>
							+
						</button>
					)}

					{/* Chevron (right side) */}
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 10 10"
						fill="none"
						className={[
							"shrink-0 transition-transform duration-[120ms]",
							isExpanded ? "rotate-90" : "rotate-0",
							isActiveProject ? "text-[var(--text-quaternary)]" : "text-[#3a3a42]",
						].join(" ")}
					>
						<path
							d="M3 1.5L7 5L3 8.5"
							stroke="currentColor"
							strokeWidth="1.3"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>

				{/* Expanded workspace list */}
				{isExpanded && isReady && workspacesList && (
					<div className="flex flex-col pt-0.5">
						{visibleWorkspaces.map((ws) => (
							<WorkspaceItem
								key={ws.id}
								workspace={ws}
								projectId={project.id}
								projectName={project.name}
								projectRepoPath={project.repoPath}
								isInActiveProject={isActiveProject}
							/>
						))}
					</div>
				)}
			</div>

			{contextMenu && (
				<ProjectContextMenu
					project={project}
					position={contextMenu}
					onClose={() => setContextMenu(null)}
				/>
			)}
		</div>
	);
}
